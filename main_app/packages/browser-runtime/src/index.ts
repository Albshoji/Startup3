// Mapa recorder for the browser. Imported (for its side effect) by every browser file annotated by
// @mapa/babel-plugin; installs `globalThis.__mapa` once per page.
//
// Like appmap-node's recorder (referencias/appmap-node/src/recorder.ts) it records a call and a
// return for each annotated function. The browser has no AsyncLocalStorage, so the logical call
// stack is kept by hand: the plugin marks each `await`, and `bf`/`af` save and restore the frame
// around it (docs/appmap-mapping.md §4).
import {
  classOf,
  EVENTS_PATH,
  maskSummary,
  RECORD_PATH,
  summarize,
  type CallEvent,
  type Event,
  type FunctionMeta,
  type MapaRuntime,
  type Parameter,
  type ReturnEvent,
} from "@mapa/format";

declare const process: { env: Record<string, string | undefined> };

/** Logical stack frame. Immutable: async continuations keep a reference to the one they resume. */
interface Frame {
  id: number;
  parent: Frame | null;
  pkg: number;
  recorded: boolean;
}

interface Box {
  v?: unknown;
  e?: unknown;
  failed?: boolean;
}

const BROWSER_THREAD = 1;
const FLUSH_MS = 500;
const STATUS_MS = 1000;

const passthrough: MapaRuntime = {
  r: (thisArg, fn, args) => fn.apply(thisArg, Array.from(args)),
  cur: () => null,
  bf: (value) => Promise.resolve(value).then(ok, fail),
  af: (_frame, box) => unbox(box as Box),
  rs: () => {},
};

function ok(v: unknown): Box {
  return { v };
}
function fail(e: unknown): Box {
  return { e, failed: true };
}
function unbox(box: Box): unknown {
  if (box.failed) throw box.e;
  return box.v;
}

const g = globalThis as { __mapa?: MapaRuntime; window?: unknown };
if (!g.__mapa) g.__mapa = typeof window !== "undefined" ? install(collectorUrl()) : passthrough;

function collectorUrl(): string | undefined {
  try {
    // Inlined by Next from `env` in next.config (set by withMapa when MAPA=1).
    return process.env.MAPA_COLLECTOR_URL || undefined;
  } catch {
    return undefined;
  }
}

/** React passes components a second argument nobody declares: record only the declared ones. */
function recordedArgs(args: ArrayLike<unknown>, meta: FunctionMeta): unknown[] {
  const all = Array.from(args);
  return meta.labels.includes("mapa.react-component") ? all.slice(0, Math.max(1, meta.params.length)) : all;
}

function install(collector: string | undefined): MapaRuntime {
  const originalFetch = window.fetch.bind(window);
  // One id per page load (and per tab): the source of these events for the collector.
  const tab = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const source = `browser-${tab}`;
  let recording = false;
  let nextId = 1;
  let queue: Event[] = [];
  let current: Frame | null = null;

  const now = () => (performance.timeOrigin + performance.now()) / 1000;
  const param = (value: unknown, name?: string): Parameter => ({
    ...(name !== undefined ? { name } : {}),
    class: classOf(value),
    value: maskSummary(name, summarize(value)),
  });
  const exception = (e: unknown) => {
    const err = e as { name?: unknown; message?: unknown } | null;
    return [{ class: typeof err?.name === "string" ? err.name : classOf(e), message: summarize(err?.message ?? e) }];
  };

  function r<T>(thisArg: unknown, fn: (...args: unknown[]) => T, args: ArrayLike<unknown>, meta: FunctionMeta): T {
    if (!recording || !meta) return fn.apply(thisArg, Array.from(args));
    const parent = current;
    // AppMap `shallow`: a call from a package to itself is not recorded (only the entry into it).
    if (meta.shallow && parent && parent.recorded && parent.pkg === meta.pkg) return fn.apply(thisArg, Array.from(args));

    const id = nextId++;
    const call: CallEvent = {
      id,
      event: "call",
      thread_id: BROWSER_THREAD,
      timestamp: now(),
      layer: "browser",
      defined_class: meta.klass,
      method_id: meta.id,
      path: meta.path,
      lineno: meta.lineno,
      static: meta.static,
      parameters: recordedArgs(args, meta).map((a, i) => param(a, meta.params[i] ?? `arg${i}`)),
    };
    if (parent) call.parent_id = parent.id;
    if (meta.labels.length) call.labels = meta.labels;
    queue.push(call);

    const started = performance.now();
    const done = (fields: Partial<ReturnEvent>) => {
      if (!recording) return; // stopped meanwhile: the collector closes the call
      queue.push({ id: nextId++, event: "return", thread_id: BROWSER_THREAD, parent_id: id, elapsed: (performance.now() - started) / 1000, ...fields });
    };

    current = { id, parent, pkg: meta.pkg, recorded: true };
    let result: T;
    try {
      result = fn.apply(thisArg, Array.from(args));
    } catch (e) {
      done({ exceptions: exception(e) });
      throw e;
    } finally {
      current = parent;
    }
    // Only real Promises are followed (reading `.then` of other objects could run user getters).
    if (result instanceof Promise) {
      result.then(
        (value) => done({ return_value: param(value) }),
        (e) => done({ exceptions: exception(e) }),
      );
    } else done({ return_value: param(result) });
    return result;
  }

  // `await x` → `af(frame, await bf(x))`: while waiting, other tasks run with no frame; on resume
  // the frame saved at the function start is restored.
  function bf(value: unknown): Promise<Box> {
    let promise: Promise<unknown>;
    const then = value !== null && (typeof value === "object" || typeof value === "function") && !(value instanceof Promise) ? (value as { then?: unknown }).then : undefined;
    if (typeof then === "function") {
      // Thenables (e.g. supabase-js query builders) start now, while the caller's frame is current,
      // instead of in a later microtask (same result as a plain `await`).
      promise = new Promise((resolve, reject) => (then as (a: unknown, b: unknown) => void).call(value, resolve, reject));
    } else promise = Promise.resolve(value);
    current = null;
    return promise.then(ok, fail);
  }
  function af(frame: unknown, box: unknown): unknown {
    current = (frame as Frame | null) ?? null;
    return unbox(box as Box);
  }
  function rs(frame: unknown) {
    current = (frame as Frame | null) ?? null;
  }

  // ---- talking to the collector ----
  function flush(useBeacon = false) {
    if (!collector || queue.length === 0) return;
    const batch = queue;
    queue = [];
    const url = `${collector}${EVENTS_PATH}?source=${source}`;
    const body = JSON.stringify(batch);
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, body);
      return;
    }
    // text/plain keeps it a "simple" CORS request (no preflight).
    originalFetch(url, { method: "POST", body, headers: { "content-type": "text/plain" }, keepalive: body.length < 60_000 }).catch(() => {});
  }

  async function checkStatus() {
    if (!collector) return;
    try {
      const res = await originalFetch(`${collector}${RECORD_PATH}`, { cache: "no-store" });
      const status = (await res.json()) as { enabled?: boolean };
      const enabled = status.enabled === true;
      if (enabled !== recording) {
        if (!enabled) flush();
        recording = enabled;
        queue = enabled ? queue : [];
      }
    } catch {
      recording = false;
      queue = [];
    }
  }

  if (collector) {
    void checkStatus();
    setInterval(() => void checkStatus(), STATUS_MS);
    setInterval(() => flush(), FLUSH_MS);
    window.addEventListener("pagehide", () => flush(true));
  }

  return { r, cur: () => current, bf, af, rs };
}
