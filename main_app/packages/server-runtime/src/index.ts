// Mapa recorder for the Next.js server (Node runtime). Imported (for its side effect) by every
// server file annotated by @mapa/babel-plugin; installs `globalThis.__mapa` once per process,
// shared by all of Next's module graphs (RSC, SSR, route handlers, proxy).
//
// Same idea as appmap-node (referencias/appmap-node/src/recorder.ts): AsyncLocalStorage keeps the
// current call across `await`. Unlike appmap-node, which buffers async continuations to get the
// order right, each call carries its parent explicitly and the collector rebuilds the order
// (docs/appmap-mapping.md §4).
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
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

interface Frame {
  id: number;
  thread: number;
  pkg: number;
}

const FLUSH_MS = 300;
const STATUS_MS = 1000;
const SOURCE = `server-${process.pid}`;

const g = globalThis as { __mapa?: MapaRuntime };
if (!g.__mapa) g.__mapa = install(process.env.MAPA_COLLECTOR_URL);

/** React passes components a second argument nobody declares: record only the declared ones. */
function recordedArgs(args: ArrayLike<unknown>, meta: FunctionMeta): unknown[] {
  const all = Array.from(args);
  return meta.labels.includes("mapa.react-component") ? all.slice(0, Math.max(1, meta.params.length)) : all;
}

function install(collector: string | undefined): MapaRuntime {
  const als = new AsyncLocalStorage<Frame>();
  let recording = false;
  let nextId = 1;
  let nextThread = 1;
  let queue: Event[] = [];

  const now = () => Date.now() / 1000;
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
    const parent = als.getStore();
    if (meta.shallow && parent && parent.pkg === meta.pkg) return fn.apply(thisArg, Array.from(args));

    const id = nextId++;
    // A call with no parent starts a new logical thread (e.g. one per incoming request).
    const thread = parent ? parent.thread : nextThread++;
    const call: CallEvent = {
      id,
      event: "call",
      thread_id: thread,
      timestamp: now(),
      layer: "next-server",
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
      if (!recording) return;
      queue.push({ id: nextId++, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - started) / 1000, ...fields });
    };

    let result: T;
    try {
      result = als.run({ id, thread, pkg: meta.pkg }, () => fn.apply(thisArg, Array.from(args)));
    } catch (e) {
      done({ exceptions: exception(e) });
      throw e;
    }
    if (result instanceof Promise) {
      result.then(
        (value) => done({ return_value: param(value) }),
        (e) => done({ exceptions: exception(e) }),
      );
    } else done({ return_value: param(result) });
    return result;
  }

  // ---- talking to the collector (node:http, so Next's patched fetch never sees these requests) ----
  const target = collector ? new URL(collector) : undefined;

  function request(method: string, path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!target) return reject(new Error("no collector"));
      const req = http.request(
        { host: target.hostname, port: target.port, path, method, headers: body ? { "content-type": "application/json" } : {} },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => resolve(data));
        },
      );
      req.on("error", reject);
      req.setTimeout(5000, () => req.destroy(new Error("timeout")));
      req.end(body);
    });
  }

  function flush() {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    request("POST", `${EVENTS_PATH}?source=${SOURCE}`, JSON.stringify(batch)).catch(() => {});
  }

  async function checkStatus() {
    try {
      const status = JSON.parse(await request("GET", RECORD_PATH)) as { enabled?: boolean };
      const enabled = status.enabled === true;
      if (enabled !== recording) {
        if (!enabled) flush();
        recording = enabled;
        if (!enabled) queue = [];
      }
    } catch {
      recording = false;
      queue = [];
    }
  }

  if (target) {
    // Timers never keep the process alive.
    void checkStatus();
    setInterval(() => void checkStatus(), STATUS_MS).unref();
    setInterval(flush, FLUSH_MS).unref();
  }

  return { r };
}
