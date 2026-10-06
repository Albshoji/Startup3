// Mapa recorder for the Next.js server (Node runtime). Imported (for its side effect) by every
// server file annotated by @mapa/babel-plugin; installs `globalThis.__mapa` once per process,
// shared by all of Next's module graphs (RSC, SSR, route handlers, proxy).
//
// Same idea as appmap-node (referencias/appmap-node/src/recorder.ts and src/hooks/http.ts):
// AsyncLocalStorage keeps the current call across `await`; incoming requests become
// `http_server_request`; outgoing requests become `http_client_request`. Unlike appmap-node,
// outgoing requests are taken from `fetch` (how supabase-js talks to Supabase), and each call
// carries its parent explicitly so the collector rebuilds the order (docs/appmap-mapping.md §4–5).
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import {
  classOf,
  EVENTS_PATH,
  NO_STATUS,
  parameterValue,
  RECORD_PATH,
  SYNTHETIC_PATHS,
  textValue,
  type CallEvent,
  type Event,
  type FunctionMeta,
  type MapaRuntime,
  type Parameter,
  type ReturnEvent,
} from "@mapa/format";
import { isSupabaseUrl, translateSupabaseRequest } from "@mapa/supabase";

interface Frame {
  id: number;
  thread: number;
  pkg: number;
}

const FLUSH_MS = 300;
const STATUS_MS = 1000;
const SOURCE = `server-${process.pid}`;
/** Next internals and static files, like appmap-node ignores `/_next/static` and images. */
const IGNORED_PATHS = /^\/(_next\/(static|image|webpack-hmr)|__nextjs|favicon\.ico)/;
const SERVER_REQUEST_HEADERS = ["content-type", "accept", "next-action", "rsc", "next-router-prefetch", "traceparent"];
const CLIENT_REQUEST_HEADERS = ["content-type", "accept", "prefer", "range"];
const RESPONSE_HEADERS = ["content-type", "content-range", "content-length", "sb-request-id", "x-deno-execution-id", "preference-applied"];
const READABLE_BODY = /json|text\/plain|xml/;
const BODY_READ_LIMIT = 256 * 1024;

const g = globalThis as { __mapa?: MapaRuntime };
if (!g.__mapa) g.__mapa = install(process.env.MAPA_COLLECTOR_URL);

/** React passes components a second argument nobody declares: record only the declared ones. */
function recordedArgs(args: ArrayLike<unknown>, meta: FunctionMeta): unknown[] {
  const all = Array.from(args);
  return meta.labels.includes("mapa.react-component") ? all.slice(0, Math.max(1, meta.params.length)) : all;
}

function install(collector: string | undefined): MapaRuntime {
  const als = new AsyncLocalStorage<Frame>();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let recording = false;
  let nextId = 1;
  let nextThread = 1;
  let queue: Event[] = [];

  const now = () => Date.now() / 1000;
  const param = (value: unknown, name?: string): Parameter => ({
    ...(name !== undefined ? { name } : {}),
    class: classOf(value),
    value: parameterValue(name, value),
  });
  // AppMap exceptions carry an object_id: the same error thrown through several calls keeps its id.
  const objectIds = new WeakMap<object, number>();
  let nextObjectId = 1;
  const objectId = (value: unknown) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return nextObjectId++;
    let id = objectIds.get(value);
    if (id === undefined) objectIds.set(value, (id = nextObjectId++));
    return id;
  };
  const exception = (e: unknown) => {
    const err = e as { name?: unknown; message?: unknown } | null;
    return [{ class: typeof err?.name === "string" ? err.name : classOf(e), message: parameterValue(undefined, err?.message ?? e).replace(/^"|"$/g, ""), object_id: objectId(e) }];
  };
  /** A failed HTTP call (network error): class and message only. */
  const errorInfo = (e: unknown) => {
    const { class: errorClass, message } = exception(e)[0]!;
    return { class: errorClass, message };
  };
  const emit = (event: Event) => {
    if (recording) queue.push(event);
  };

  /** A new call: child of the current frame, or the start of a new logical thread. */
  function callBase(extra: Partial<CallEvent>): { call: CallEvent; thread: number } {
    const parent = als.getStore();
    const thread = parent ? parent.thread : nextThread++;
    const call = { id: nextId++, event: "call", thread_id: thread, timestamp: now(), layer: "next-server", ...extra } as CallEvent;
    if (parent) call.parent_id = parent.id;
    return { call, thread };
  }

  function returnOf(callId: number, thread: number, started: number, fields: Partial<ReturnEvent>): ReturnEvent {
    return { id: nextId++, event: "return", thread_id: thread, parent_id: callId, elapsed: (performance.now() - started) / 1000, ...fields };
  }

  // ---- functions ----

  function r<T>(thisArg: unknown, fn: (...args: unknown[]) => T, args: ArrayLike<unknown>, meta: FunctionMeta): T {
    if (!recording || !meta) return fn.apply(thisArg, Array.from(args));
    const parent = als.getStore();
    if (meta.shallow && parent && parent.pkg === meta.pkg) return fn.apply(thisArg, Array.from(args));

    const { call, thread } = callBase({
      defined_class: meta.klass,
      method_id: meta.id,
      path: meta.path,
      lineno: meta.lineno,
      static: meta.static,
      parameters: recordedArgs(args, meta).map((a, i) => param(a, meta.params[i] ?? `arg${i}`)),
    });
    if (meta.labels.length) call.labels = meta.labels;
    emit(call);

    const started = performance.now();
    const done = (fields: Partial<ReturnEvent>) => emit(returnOf(call.id, thread, started, fields));

    let result: T;
    try {
      result = als.run({ id: call.id, thread, pkg: meta.pkg }, () => fn.apply(thisArg, Array.from(args)));
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

  // ---- incoming requests (http_server_request), like appmap-node's hooks/http.ts ----

  const originalEmit = http.Server.prototype.emit as (this: http.Server, event: string | symbol, ...args: unknown[]) => boolean;
  http.Server.prototype.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event !== "request" || !recording) return originalEmit.call(this, event, ...args);
    const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
    const url = new URL(req.url ?? "/", "http://localhost");
    if (IGNORED_PATHS.test(url.pathname)) return originalEmit.call(this, event, ...args);

    const headers = pickHeaders((name) => headerValue(req.headers[name]), SERVER_REQUEST_HEADERS);
    // Each request starts a new logical thread, even if Next handles it inside another context.
    const thread = nextThread++;
    const call = {
      id: nextId++,
      event: "call",
      thread_id: thread,
      timestamp: now(),
      layer: "next-server",
      http_server_request: {
        request_method: (req.method ?? "GET").toUpperCase(),
        path_info: url.pathname,
        protocol: `HTTP/${req.httpVersion}`,
        ...(headers ? { headers } : {}),
      },
      message: [...url.searchParams].map(([name, value]) => ({ name, class: "String", value: parameterValue(name, value) })),
    } as CallEvent;
    const link = parseTraceparent(headerValue(req.headers.traceparent));
    if (link) call.remote_parent = link;
    if (req.headers["next-action"]) call.labels = ["mapa.server-action"];
    emit(call);

    const started = performance.now();
    res.once("close", () => {
      const contentType = res.getHeader("content-type");
      emit(
        returnOf(call.id, thread, started, {
          http_server_response: { status_code: validStatus(res.statusCode), ...(contentType ? { headers: { "content-type": String(contentType) } } : {}) },
          ...(res.writableFinished ? {} : { error: { class: "Aborted", message: "a resposta não terminou (conexão fechada)" } }),
        }),
      );
    });
    return als.run({ id: call.id, thread, pkg: -1 }, () => originalEmit.call(this, event, ...args));
  } as typeof http.Server.prototype.emit;

  // ---- outgoing requests (fetch → http_client_request) ----

  const originalFetch = globalThis.fetch;
  const mapaFetch = function (this: unknown, input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    if (!recording) return originalFetch.call(this, input, init);
    const request = input instanceof Request ? input : undefined;
    let url: URL;
    try {
      url = new URL(request ? request.url : String(input));
    } catch {
      return originalFetch.call(this, input, init);
    }
    const headers = new Headers(init?.headers ?? request?.headers);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : init?.body ? `[${classOf(init.body)}]` : undefined;

    const message: Parameter[] = [...url.searchParams].map(([name, value]) => ({ name, class: "String", value: parameterValue(name, value) }));
    if (body !== undefined) message.push({ name: "body", class: "String", value: textValue(body) });
    const picked = pickHeaders((name) => headers.get(name), CLIENT_REQUEST_HEADERS);
    const { call, thread } = callBase({
      http_client_request: { request_method: method, url: url.origin + url.pathname, ...(picked ? { headers: picked } : {}) },
      message,
    });
    if (isSupabaseUrl(url, supabaseUrl)) {
      const { info, labels } = translateSupabaseRequest({ method, url, headers, body });
      call.supabase = info;
      if (labels.length) call.labels = labels;
    }
    emit(call);

    const started = performance.now();
    const promise = originalFetch.call(this, input, init);
    promise.then(
      async (response) => {
        const contentType = response.headers.get("content-type") ?? "";
        const length = Number(response.headers.get("content-length") ?? 0);
        let returnValue: Parameter | undefined;
        if (READABLE_BODY.test(contentType) && length <= BODY_READ_LIMIT && response.status !== 204) {
          try {
            returnValue = { class: contentType.split(";")[0] || "String", value: textValue(await response.clone().text()) };
          } catch {
            // body already used or stream error: keep the status only
          }
        }
        const responseHeaders = pickHeaders((name) => response.headers.get(name), RESPONSE_HEADERS);
        emit(
          returnOf(call.id, thread, started, {
            http_client_response: { status_code: validStatus(response.status), ...(responseHeaders ? { headers: responseHeaders } : {}), ...(returnValue ? { return_value: returnValue } : {}) },
          }),
        );
      },
      (error: unknown) => emit(returnOf(call.id, thread, started, { http_client_response: { status_code: NO_STATUS }, error: errorInfo(error) })),
    );
    return promise;
  };
  // Keep the markers Next puts on its patched fetch (e.g. `__nextPatched`), so it does not patch again.
  Object.assign(mapaFetch, originalFetch);
  globalThis.fetch = mapaFetch as typeof fetch;

  // ---- console (only inside a recorded call, so Next's own logs stay out) ----

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      if (recording && als.getStore()) {
        const { call, thread } = callBase({ defined_class: "console", method_id: level, path: SYNTHETIC_PATHS.console, static: true, labels: ["log"], parameters: args.slice(0, 5).map((a, i) => param(a, `arg${i}`)) });
        emit(call);
        emit(returnOf(call.id, thread, performance.now(), { return_value: param(undefined) }));
      }
      return original.apply(this, args);
    };
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

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}

function pickHeaders(get: (name: string) => string | null, names: string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = get(name);
    if (value !== null && value !== undefined) out[name] = value.length > 200 ? `${value.slice(0, 199)}…` : value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** W3C traceparent from a browser tab: `00-<tab id>-<event id in hex>-01`. */
function parseTraceparent(value: string | null): { source: string; id: number } | undefined {
  const match = value ? /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(value) : null;
  if (!match) return undefined;
  const id = parseInt(match[2]!, 16);
  return Number.isSafeInteger(id) && id > 0 ? { source: `browser-${match[1]}`, id } : undefined;
}

function validStatus(status: number): number {
  return status >= 100 && status <= 599 ? status : NO_STATUS;
}
