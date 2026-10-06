// Mapa recorder for the browser. Imported (for its side effect) by every browser file annotated by
// @mapa/babel-plugin; installs `globalThis.__mapa` once per page.
//
// Like appmap-node's recorder (referencias/appmap-node/src/recorder.ts) it records a call and a
// return for each annotated function. The browser has no AsyncLocalStorage, so the logical call
// stack is kept by hand: the plugin marks each `await`, and `bf`/`af` save and restore the frame
// around it (docs/appmap-mapping.md §4).
//
// On top of functions it records what AppMap records for a backend's requests, adapted to the
// browser (docs/appmap-mapping.md §5 and §8): user actions (click, submit, typing, navigation),
// fetch/XHR, WebSocket (Supabase Realtime), uncaught errors and console output.
import {
  CallCap,
  classOf,
  clipValue,
  consoleMeta,
  DEFAULT_LIMITS,
  omittedCall,
  EVENTS_PATH,
  maskSummary,
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
import { isSupabaseUrl, parseRealtimeFrame, translateSupabaseRequest } from "@mapa/supabase";
import { mountUi, type CollectorStatus, type Ui } from "./ui.js";

declare const process: { env: Record<string, string | undefined> };

/** Logical stack frame. Immutable: async continuations keep a reference to the one they resume. */
interface Frame {
  id: number;
  parent: Frame | null;
  pkg: number;
  /** The user action this frame belongs to. */
  action: Action | null;
  /** Ceiling of calls per function for this action (or this root call, outside actions). */
  cap?: CallCap;
  /** An omitted call (beyond the ceiling): what it calls is omitted too. */
  skipped?: boolean;
  /** For an omitted frame: id of the nearest recorded ancestor. */
  anchorId?: number;
}

interface Action {
  frame: Frame;
  kind: string;
  started: number;
  lastActivity: number;
  pending: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  cap: CallCap;
}

interface Box {
  v?: unknown;
  e?: unknown;
  failed?: boolean;
}

const BROWSER_THREAD = 1;
const FLUSH_MS = 500;
const STATUS_MS = 1000;
/** An action ends after this long with nothing pending (docs/appmap-mapping.md §8). */
const ACTION_IDLE_MS = 500;
/** Keystrokes in the same field closer than this belong to the same "type" action. */
const TYPING_GAP_MS = 1000;
const REQUEST_HEADERS = ["content-type", "accept", "prefer", "range", "next-action", "rsc", "next-router-state-tree", "traceparent"];
const RESPONSE_HEADERS = ["content-type", "content-range", "content-length", "sb-request-id", "x-deno-execution-id", "preference-applied"];
const READABLE_BODY = /json|text\/plain|text\/html|xml|form-urlencoded/;
const BODY_READ_LIMIT = 256 * 1024;

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

const g = globalThis as { __mapa?: MapaRuntime };
if (!g.__mapa) g.__mapa = typeof window !== "undefined" ? install(env("MAPA_COLLECTOR_URL")) : passthrough;

function env(name: "MAPA_COLLECTOR_URL" | "NEXT_PUBLIC_SUPABASE_URL"): string | undefined {
  try {
    // Inlined by Next (`env` in next.config is set by withMapa; NEXT_PUBLIC_* by Next itself).
    return name === "MAPA_COLLECTOR_URL" ? process.env.MAPA_COLLECTOR_URL || undefined : process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
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
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  // One id per page load (and per tab). It is the trace-id of `traceparent`, so the server can tell
  // which tab (and which event of it) made each request; the collector uses it as the source name.
  const tab = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const source = `browser-${tab}`;
  // From page load until the collector first answers, record provisionally: code that runs right
  // at load (useEffect, Realtime subscriptions) would otherwise be lost when a recording is on.
  let recording = !!collector;
  let provisional = !!collector;
  let nextId = 1;
  let queue: Event[] = [];
  let current: Frame | null = null;
  const suspended = new Set<Frame>(); // frames waiting on an await
  const openActions: Action[] = [];
  /** Changes whenever a recording starts, stops or is dropped: frames of another epoch were never sent. */
  let epoch = 0;
  let capMax = DEFAULT_LIMITS.maxCallsPerFunctionPerAction;

  const now = () => (performance.timeOrigin + performance.now()) / 1000;
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
  // Memory guard: never hold more than the recording may keep (the collector stops at its limit).
  let queueLimit = DEFAULT_LIMITS.maxEvents;
  const emit = (event: Event) => {
    if (recording && queue.length < queueLimit) queue.push(event);
  };
  /** A text shown as is (descriptions, paths): masked and cut, without JSON quoting. */
  const plain = (name: string, text: string) => clipValue(maskSummary(name, text));

  // ---- where a new event hangs in the tree ----

  interface Placement {
    frame: Frame | null;
    inferred: boolean;
  }

  /** The current frame; with none, the most recent open action (e.g. a React re-render it scheduled). */
  function place(): Placement {
    if (current) return { frame: current, inferred: false };
    const action = openActions[openActions.length - 1];
    if (action) {
      touch(action, 0);
      return { frame: action.frame, inferred: true };
    }
    return { frame: null, inferred: false };
  }

  /** Id to hang a new event on: an omitted frame was never recorded, so use its nearest recorded ancestor. */
  const anchorIdOf = (frame: Frame | null) => (frame ? (frame.skipped ? frame.anchorId : frame.id) : undefined);

  function callBase(placement: Placement, extra: Partial<CallEvent>): CallEvent {
    const call = { id: nextId++, event: "call", thread_id: BROWSER_THREAD, timestamp: now(), layer: "browser", ...extra } as CallEvent;
    const parentId = anchorIdOf(placement.frame);
    if (parentId !== undefined) call.parent_id = parentId;
    if (placement.inferred) call.attribution = "inferred";
    return call;
  }

  /** Applies the ceiling to a synthetic call (console) made inside `frame`. */
  function withinCap(frame: Frame, meta: FunctionMeta): boolean {
    if (!frame.cap) return true;
    if (frame.skipped) {
      frame.cap.noteOmitted(meta, frame.anchorId, now());
      return false;
    }
    return frame.cap.admit(meta, frame.id, now());
  }

  /** One `Mapa.omitted` call per function that went over the ceiling. */
  function reportOmitted(cap: CallCap) {
    for (const summary of cap.take()) {
      const call = omittedCall(summary, { id: nextId++, thread_id: BROWSER_THREAD, layer: "browser" });
      emit(call);
      emit({ id: nextId++, event: "return", thread_id: BROWSER_THREAD, parent_id: call.id, elapsed: 0, return_value: { class: "Number", value: String(summary.omitted) } });
    }
  }

  function returnOf(callId: number, started: number, fields: Partial<ReturnEvent>): ReturnEvent {
    return { id: nextId++, event: "return", thread_id: BROWSER_THREAD, parent_id: callId, elapsed: (performance.now() - started) / 1000, ...fields };
  }

  // ---- functions ----

  function r<T>(thisArg: unknown, fn: (...args: unknown[]) => T, args: ArrayLike<unknown>, meta: FunctionMeta): T {
    if (!recording || !meta) return fn.apply(thisArg, Array.from(args));
    const placement = place();
    const parent = placement.frame;
    // AppMap `shallow`: a call from a package to itself is not recorded (only the entry into it).
    if (meta.shallow && parent && !parent.skipped && parent.pkg === meta.pkg) return fn.apply(thisArg, Array.from(args));

    // Ceiling of calls per function within the action: beyond it, only counted.
    const ownsCap = !parent?.cap;
    const cap = parent?.cap ?? new CallCap(capMax);
    const anchorId = anchorIdOf(parent);
    if (parent?.skipped) cap.noteOmitted(meta, anchorId, now());
    if (parent?.skipped || !cap.admit(meta, anchorId, now())) {
      const saved = current;
      current = { id: -1, parent, pkg: meta.pkg, action: parent?.action ?? null, cap, skipped: true, ...(anchorId !== undefined ? { anchorId } : {}) };
      try {
        return fn.apply(thisArg, Array.from(args));
      } finally {
        current = saved;
      }
    }

    const call = callBase(placement, {
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
    const done = (fields: Partial<ReturnEvent>) => {
      emit(returnOf(call.id, started, fields));
      if (ownsCap) reportOmitted(cap); // a root call outside any action owns its ceiling
    };

    const saved = current;
    current = { id: call.id, parent, pkg: meta.pkg, action: parent?.action ?? null, cap };
    let result: T;
    try {
      result = fn.apply(thisArg, Array.from(args));
    } catch (e) {
      done({ exceptions: exception(e) });
      throw e;
    } finally {
      current = saved;
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
    if (current) suspended.add(current);
    current = null;
    return promise.then(ok, fail);
  }
  function af(frame: unknown, box: unknown): unknown {
    if (frame) suspended.delete(frame as Frame);
    current = (frame as Frame | null) ?? null;
    return unbox(box as Box);
  }
  function rs(frame: unknown) {
    current = (frame as Frame | null) ?? null;
  }

  // ---- user actions ----

  function startAction(kind: string, target: string, targetClass: string, extra: Parameter[] = [], startedAt?: number): Action {
    const call = callBase({ frame: null, inferred: false }, {
      defined_class: "Browser",
      method_id: kind,
      path: SYNTHETIC_PATHS.browser,
      static: true,
      labels: ["mapa.user-action"],
      parameters: [{ name: "target", class: targetClass, value: plain("target", target) }, ...extra],
    });
    if (startedAt !== undefined) call.timestamp = startedAt;
    emit(call);
    const cap = new CallCap(capMax);
    const frame: Frame = { id: call.id, parent: null, pkg: -1, action: null, cap };
    const action: Action = { frame, kind, started: performance.now(), lastActivity: performance.now(), pending: 0, timer: undefined, cap };
    frame.action = action;
    openActions.push(action);
    touch(action, 0);
    return action;
  }

  function touch(action: Action, delta: number) {
    action.pending += delta;
    action.lastActivity = performance.now();
    if (action.timer) clearTimeout(action.timer);
    action.timer = action.pending <= 0 ? setTimeout(() => finishAction(action), ACTION_IDLE_MS) : undefined;
  }

  function finishAction(action: Action) {
    const index = openActions.indexOf(action);
    if (index < 0) return;
    openActions.splice(index, 1);
    reportOmitted(action.cap);
    // Ends at its last activity, not at the end of the idle wait.
    emit({ id: nextId++, event: "return", thread_id: BROWSER_THREAD, parent_id: action.frame.id, elapsed: (action.lastActivity - action.started) / 1000 });
  }

  /** While the browser dispatches the event, code that runs belongs to the action. */
  function enter(action: Action) {
    current = action.frame;
    setTimeout(() => {
      if (current === action.frame) current = null;
    }, 0);
  }

  function describeElement(target: EventTarget | null): { text: string; element: Element | null } {
    const el = target instanceof Element ? target : null;
    if (!el) return { text: "página", element: null };
    const interesting = el.closest("button, a, [role=button], input, select, textarea, label, summary, [onclick]") ?? el;
    const tag = interesting.tagName.toLowerCase();
    const id = interesting.id ? `#${interesting.id}` : "";
    const type = interesting instanceof HTMLInputElement ? `[type=${interesting.type}]` : "";
    // Never the value of a field: only visible labels of buttons and links.
    const label =
      interesting.getAttribute("aria-label") ||
      (interesting instanceof HTMLInputElement && (interesting.type === "submit" || interesting.type === "button") ? interesting.value : "") ||
      (interesting.matches("button, a, [role=button], summary, label") ? (interesting as HTMLElement).innerText : "") ||
      interesting.getAttribute("name") ||
      interesting.getAttribute("placeholder") ||
      "";
    const text = label.trim().replace(/\s+/g, " ").slice(0, 40);
    return { text: `${tag}${id}${type}${text ? ` "${text}"` : ""}`, element: interesting };
  }

  const fromMapaUi = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-mapa-ui]");

  let lastClick: { action: Action; element: Element | null; at: number } | undefined;
  function onPointerAction(kind: "click" | "submit") {
    return (event: Event | globalThis.Event) => {
      const ev = event as globalThis.Event;
      if (!recording || fromMapaUi(ev.target)) return;
      // Clicking a submit button also fires "submit": for the user it is one action.
      if (kind === "submit" && lastClick && performance.now() - lastClick.at < 100 && openActions.includes(lastClick.action)) {
        const form = ev.target instanceof HTMLFormElement ? ev.target : null;
        if (!lastClick.element || !form || form.contains(lastClick.element)) {
          enter(lastClick.action);
          return;
        }
      }
      const { text, element } = describeElement(ev.target);
      const action = startAction(kind, text, "Element");
      if (kind === "click") lastClick = { action, element, at: performance.now() };
      enter(action);
    };
  }

  let typing: { element: Element; action: Action; last: number } | undefined;
  function onInput(event: globalThis.Event) {
    if (!recording || fromMapaUi(event.target)) return;
    const { text, element } = describeElement(event.target);
    if (!element) return;
    const t = performance.now();
    if (typing && typing.element === element && t - typing.last < TYPING_GAP_MS && openActions.includes(typing.action)) {
      typing.last = t;
      touch(typing.action, 0);
      enter(typing.action);
      return;
    }
    typing = { element, action: startAction("type", text, "Element"), last: t };
    enter(typing.action);
  }

  let lastUrl = location.href;
  function navigated(how: string, startedAt?: number) {
    if (!recording) return;
    lastUrl = location.href;
    const path = `${location.pathname}${location.search}`;
    enter(startAction("navigate", `${how} ${path}`, "Location", [{ name: "url", class: "String", value: plain("url", path) }], startedAt));
  }

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      if (location.href !== lastUrl) navigated(method === "pushState" ? "abrir" : "trocar para");
      lastUrl = location.href;
      return result;
    } as History["pushState"];
  }
  window.addEventListener("popstate", () => navigated("voltar/avançar para"));
  window.addEventListener("click", onPointerAction("click"), true);
  window.addEventListener("submit", onPointerAction("submit"), true);
  window.addEventListener("input", onInput, true);
  // After the app's own handlers (bubble phase on window is the last stop), the dispatch is over.
  const leave = () => {
    if (current && current.parent === null && current.action?.frame === current) current = null;
  };
  window.addEventListener("click", leave);
  window.addEventListener("submit", leave);
  window.addEventListener("input", leave);

  // ---- uncaught errors ----

  function recordError(kind: string, error: unknown, fallbackMessage: string) {
    if (!recording) return;
    const placement = place();
    const message = error instanceof Error ? error.message : fallbackMessage;
    const call = callBase(placement, {
      defined_class: "Browser",
      method_id: kind,
      path: SYNTHETIC_PATHS.browser,
      static: true,
      labels: ["mapa.error"],
      parameters: [{ name: "message", class: "String", value: parameterValue("message", message) }],
    });
    emit(call);
    emit(returnOf(call.id, performance.now(), { exceptions: exception(error ?? message) }));
  }
  window.addEventListener("error", (event) => recordError("error", event.error, event.message));
  window.addEventListener("unhandledrejection", (event) => recordError("unhandledrejection", event.reason, String(event.reason)));

  // ---- console ----

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level];
    const meta = consoleMeta(level);
    console[level] = function (...args: unknown[]) {
      if (recording && current && withinCap(current, meta)) {
        const call = callBase({ frame: current, inferred: false }, {
          defined_class: "console",
          method_id: level,
          path: SYNTHETIC_PATHS.console,
          static: true,
          labels: ["log"],
          parameters: args.slice(0, 5).map((a, i) => param(a, `arg${i}`)),
        });
        emit(call);
        emit(returnOf(call.id, performance.now(), { return_value: param(undefined) }));
      }
      return original.apply(this, args);
    };
  }

  // ---- HTTP: fetch and XMLHttpRequest ----

  function isInternal(url: URL): boolean {
    if (collector && url.href.startsWith(collector)) return true;
    return url.origin === location.origin && /^\/(_next\/(static|image|webpack-hmr)|__nextjs)/.test(url.pathname);
  }

  /**
   * Where a request hangs. When the only frame is the action itself (or none), the caller is
   * probably an async function of that action waiting on an await inside a library: use it, marked
   * as inferred (docs/spike-report.md, risk 2).
   */
  function placeRequest(): Placement {
    const placement = place();
    const frame = placement.frame;
    if (!frame || (frame.parent === null && frame.action?.frame === frame)) {
      const action = frame?.action ?? null;
      const candidates = [...suspended].filter((f) => action === null || f.action === action);
      const latest = candidates[candidates.length - 1];
      if (latest) return { frame: latest, inferred: true };
    }
    return placement;
  }

  function pickHeaders(headers: Headers, names: string[]): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const name of names) {
      const value = headers.get(name);
      if (value !== null) out[name] = value.length > 200 ? `${value.slice(0, 199)}…` : value;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function bodyText(body: unknown): string | undefined {
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== "undefined" && body instanceof FormData) return `[FormData: ${[...new Set(body.keys())].join(", ")}]`;
    if (body instanceof Blob) return `[${body.constructor.name} ${body.type || "?"}, ${body.size} bytes]`;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[binário, ${(body as ArrayBuffer).byteLength} bytes]`;
    return `[${classOf(body)}]`;
  }

  interface StartedRequest {
    call: CallEvent;
    started: number;
    action: Action | null;
  }

  function startRequest(method: string, url: URL, headers: Headers, body: string | undefined): StartedRequest {
    const placement = placeRequest();
    const message: Parameter[] = [...url.searchParams].map(([name, value]) => ({ name, class: "String", value: parameterValue(name, value) }));
    if (body !== undefined) message.push({ name: "body", class: "String", value: textValue(body) });
    const call = callBase(placement, {
      http_client_request: { request_method: method, url: url.origin + url.pathname, ...(pickHeaders(headers, REQUEST_HEADERS) ? { headers: pickHeaders(headers, REQUEST_HEADERS)! } : {}) },
      message,
    });
    if (isSupabaseUrl(url, supabaseUrl)) {
      const { info, labels } = translateSupabaseRequest({ method, url, headers, body });
      call.supabase = info;
      if (labels.length) call.labels = labels;
    }
    emit(call);
    const action = placement.frame?.action ?? null;
    if (action) touch(action, +1);
    return { call, started: performance.now(), action };
  }

  function endRequest(request: StartedRequest, fields: Partial<ReturnEvent>) {
    emit(returnOf(request.call.id, request.started, fields));
    if (request.action) touch(request.action, -1);
  }

  /** Same-origin requests only: a traceparent to Supabase or other sites would trigger a CORS preflight. */
  function traceparent(url: URL, headers: Headers, id: number) {
    if (url.origin === location.origin && !headers.has("traceparent")) headers.set("traceparent", `00-${tab}-${id.toString(16).padStart(16, "0")}-01`);
  }

  window.fetch = function mapaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!recording) return originalFetch(input, init);
    const request = input instanceof Request ? input : undefined;
    let url: URL;
    try {
      url = new URL(request ? request.url : String(input), location.href);
    } catch {
      return originalFetch(input, init);
    }
    const headers = new Headers(init?.headers ?? request?.headers);
    if (isInternal(url) || headers.get("next-router-prefetch") === "1") return originalFetch(input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

    const started = startRequest(method, url, headers, bodyText(init?.body));
    traceparent(url, headers, started.call.id);
    const promise = originalFetch(input, { ...init, headers });
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
        endRequest(started, {
          http_client_response: {
            status_code: response.status,
            ...(pickHeaders(response.headers, RESPONSE_HEADERS) ? { headers: pickHeaders(response.headers, RESPONSE_HEADERS)! } : {}),
            ...(returnValue ? { return_value: returnValue } : {}),
          },
        });
      },
      (error: unknown) => endRequest(started, { http_client_response: { status_code: NO_STATUS }, error: errorInfo(error) }),
    );
    return promise;
  };

  const xhrState = new WeakMap<XMLHttpRequest, { method: string; url: URL; headers: Headers }>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    try {
      xhrState.set(this, { method: method.toUpperCase(), url: new URL(String(url), location.href), headers: new Headers() });
    } catch {
      xhrState.delete(this);
    }
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as XMLHttpRequest["open"];
  XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    xhrState.get(this)?.headers.set(name, value);
    return originalSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const state = xhrState.get(this);
    if (!recording || !state || isInternal(state.url)) return originalSend.call(this, body);
    const started = startRequest(state.method, state.url, state.headers, bodyText(body));
    if (state.url.origin === location.origin && !state.headers.has("traceparent")) {
      originalSetHeader.call(this, "traceparent", `00-${tab}-${started.call.id.toString(16).padStart(16, "0")}-01`);
    }
    this.addEventListener("loadend", () => {
      if (this.status === 0) {
        endRequest(started, { http_client_response: { status_code: NO_STATUS }, error: { class: "NetworkError", message: "falha de rede ou pedido cancelado" } });
        return;
      }
      const contentType = this.getResponseHeader("content-type") ?? "";
      const text = (this.responseType === "" || this.responseType === "text") && READABLE_BODY.test(contentType) ? this.responseText : undefined;
      endRequest(started, {
        http_client_response: { status_code: this.status, ...(contentType ? { headers: { "content-type": contentType } } : {}), ...(text !== undefined ? { return_value: { class: contentType.split(";")[0]!, value: textValue(text) } } : {}) },
      });
    });
    return originalSend.call(this, body);
  };

  // ---- WebSocket (Supabase Realtime) ----

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = class MapaWebSocket extends OriginalWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols);
      let url: URL;
      try {
        url = new URL(String(address), location.href);
      } catch {
        return;
      }
      if (/webpack-hmr|turbopack|__nextjs/.test(url.pathname) || isInternal(url)) return;
      // Connections opened before Start (e.g. Realtime at page load) still have their frames recorded.
      let connection: Frame | null = null;
      let connectionEpoch = -1;
      if (recording) {
        connectionEpoch = epoch;
        const started = startRequest("GET", url, new Headers({ upgrade: "websocket" }), undefined);
        started.call.labels = [...(started.call.labels ?? []), "mapa.websocket"];
        connection = { id: started.call.id, parent: null, pkg: -1, action: started.action };
        let opened = false;
        this.addEventListener("open", () => {
          opened = true;
          endRequest(started, { http_client_response: { status_code: 101 } });
        });
        this.addEventListener("error", () => {
          if (!opened) endRequest(started, { http_client_response: { status_code: NO_STATUS }, error: { class: "WebSocketError", message: "a conexão não abriu" } });
        });
      }
      const frame = (direction: "send" | "receive", data: unknown) => {
        if (!recording) return;
        const realtime = parseRealtimeFrame(data, direction);
        if (realtime?.topic === "phoenix") return; // heartbeats
        const placement: Placement = connection && connectionEpoch === epoch ? { frame: connection, inferred: false } : place();
        const call = callBase(placement, {
          defined_class: "Realtime",
          method_id: direction,
          path: SYNTHETIC_PATHS.realtime,
          static: true,
          labels: ["mapa.websocket"],
          parameters: [{ name: "frame", class: typeof data === "string" ? "String" : classOf(data), value: typeof data === "string" ? textValue(data) : parameterValue("frame", data) }],
          ...(realtime ? { realtime } : {}),
        });
        emit(call);
        emit(returnOf(call.id, performance.now(), { return_value: param(undefined) }));
      };
      const send = this.send.bind(this);
      this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        frame("send", data);
        return send(data);
      };
      this.addEventListener("message", (event) => frame("receive", event.data));
    }
  };

  // ---- talking to the collector ----

  function flush(useBeacon = false) {
    if (!collector || queue.length === 0 || provisional) return;
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

  function applyStatus(status: CollectorStatus) {
    const enabled = status.enabled === true;
    if (status.limits?.maxCallsPerFunctionPerAction) capMax = status.limits.maxCallsPerFunctionPerAction;
    if (status.limits?.maxEvents) queueLimit = status.limits.maxEvents;
    ui?.update(status);
    if (provisional) {
      provisional = false;
      if (!enabled) {
        // No recording after all: drop what was recorded since the page load.
        recording = false;
        queue = [];
        openActions.length = 0;
        epoch++;
      }
      return;
    }
    if (enabled === recording) return;
    if (!enabled) {
      for (const action of openActions) reportOmitted(action.cap);
      flush();
      queue = [];
      openActions.length = 0;
    }
    epoch++;
    recording = enabled;
  }

  async function checkStatus() {
    if (!collector) return;
    try {
      const res = await originalFetch(`${collector}${RECORD_PATH}`, { cache: "no-store" });
      applyStatus((await res.json()) as CollectorStatus);
    } catch {
      provisional = false;
      recording = false;
      queue = [];
      ui?.update(null);
    }
  }

  // Start/Stop from the page, with the same HTTP API as `mapa record` (AppMap remote recording).
  async function startRecording() {
    const res = await originalFetch(`${collector}${RECORD_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok && res.status !== 409) throw new Error(`status ${res.status}`);
    await checkStatus();
  }
  async function stopRecording() {
    // Send what this tab still holds before the collector closes the recording.
    for (const action of openActions) reportOmitted(action.cap);
    flush();
    const res = await originalFetch(`${collector}${RECORD_PATH}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`status ${res.status}`);
    await checkStatus();
  }

  let ui: Ui | undefined;
  if (collector) {
    ui = mountUi({ start: startRecording, stop: stopRecording });
    // The page load is the first action, starting when the navigation started (before the
    // server rendered the page), so the collector can tie the server's response to it.
    navigated("carregar", performance.timeOrigin / 1000);
    void checkStatus();
    setInterval(() => void checkStatus(), STATUS_MS);
    setInterval(() => flush(), FLUSH_MS);
    window.addEventListener("pagehide", () => flush(true));
  }

  return { r, cur: () => current, bf, af, rs };
}
