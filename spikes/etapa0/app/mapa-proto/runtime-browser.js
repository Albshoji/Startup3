import { summarize, classOf } from "./summarize.js";
import { maskText, maskSummary } from "./mask.js";
import { identityFromHeaders } from "./supabase-identity.js";
// SPIKE (Etapa 0) — browser recorder. Installs globalThis.__mapa once.
const COLLECTOR = "http://localhost:47100";

if (typeof window !== "undefined" && !globalThis.__mapa) install();
else if (typeof window === "undefined" && !globalThis.__mapa) installPassthrough();

function installPassthrough() {
  globalThis.__mapa = {
    r: (t, f, a) => f.apply(t, a),
    cur: () => null,
    bf: (x) => Promise.resolve(x).then(ok, err),
    af: (_f, box) => unbox(box),
  };
}

function ok(v) { return { v }; }
function err(e) { return { e, failed: true }; }
function unbox(box) { if (box.failed) throw box.e; return box.v; }

function install() {
  const originalFetch = window.fetch.bind(window);
  let nextId = 1;
  let queue = [];
  // One id per page load (and per tab): becomes the W3C trace-id, so server requests
  // can be tied to the right tab, and event ids never collide across reloads.
  const session = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  let enabled = true;

  // A frame is an immutable stack node: { id, parent, interaction }
  let current = null;
  const suspended = new Set(); // frames waiting on an await
  const stats = { fetchExact: 0, fetchInferred: 0, fetchOrphan: 0, rendersInferred: 0 };
  window.__mapaStats = stats;

  const now = () => (performance.timeOrigin + performance.now()) / 1000;
  const emit = (e) => { queue.push(e); };

  const param = (v, name) => ({ name, class: classOf(v), value: maskSummary(name, summarize(v)) });

  function r(thisArg, fn, args, meta) {
    if (!enabled) return fn.apply(thisArg, args);
    const id = nextId++;
    let parent = current;
    let attribution;
    if (!parent && lastOpenAction) {
      // e.g. a React re-render scheduled by setState inside the action's handler
      parent = lastOpenAction;
      attribution = "inferred";
      stats.rendersInferred++;
    }
    const t0 = performance.now();
    emit({
      id, event: "call", thread_id: 1, layer: "browser", timestamp: now(), attribution,
      parent_id: parent ? parent.id : undefined,
      defined_class: meta.klass, method_id: meta.id, path: meta.path, lineno: meta.lineno,
      static: thisArg === undefined, labels: meta.labels,
      parameters: Array.from(args, (a, i) => param(a, meta.params[i] || `arg${i}`)),
    });
    current = { id, parent, interaction: parent ? parent.interaction : null };
    let result;
    try {
      result = fn.apply(thisArg, args);
    } catch (e) {
      emit({ id: nextId++, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, exceptions: [{ class: e?.name || "Error", message: String(e?.message || e) }] });
      throw e;
    } finally {
      current = attribution ? null : parent;
    }
    const retId = nextId++;
    if (result && typeof result.then === "function") {
      Promise.resolve(result).then(
        (v) => emit({ id: retId, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, return_value: param(v) }),
        (e) => emit({ id: retId, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, exceptions: [{ class: e?.name || "Error", message: String(e?.message || e) }] }),
      );
    } else {
      emit({ id: retId, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, return_value: param(result) });
    }
    return result;
  }

  // await X  ->  af(__mf, await bf(X))
  function bf(x) {
    const frame = current;
    let p;
    if (x && typeof x.then === "function" && !(x instanceof Promise)) {
      // Thenables (e.g. supabase query builders) run their `then` now, while the
      // caller's stack is still current, instead of in a later microtask.
      p = new Promise((res, rej) => x.then(res, rej));
    } else p = Promise.resolve(x);
    if (frame) suspended.add(frame);
    current = null;
    return p.then(ok, err);
  }
  function af(frame, box) {
    if (frame) suspended.delete(frame);
    current = frame;
    return unbox(box);
  }

  // ---- user actions ----
  let actionFrame = null;
  function describeTarget(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "?";
    const text = (el.innerText || el.value || el.getAttribute?.("aria-label") || "").trim().slice(0, 40);
    return `${tag}${el.id ? "#" + el.id : ""}${text ? ` "${text}"` : ""}`;
  }
  const pending = new Map(); // interaction id -> {count, timer, callId, t0, frame}
  let lastOpenAction = null;
  function touch(interaction, delta) {
    const p = pending.get(interaction);
    if (!p) return;
    p.count += delta;
    clearTimeout(p.timer);
    if (p.count <= 0) p.timer = setTimeout(() => finishAction(interaction), 500);
  }
  function finishAction(interaction) {
    const p = pending.get(interaction);
    if (!p) return;
    pending.delete(interaction);
    if (lastOpenAction && lastOpenAction.interaction === interaction) lastOpenAction = null;
    emit({ id: nextId++, event: "return", thread_id: 1, parent_id: p.callId, elapsed: (performance.now() - p.t0 - 500) / 1000 });
  }
  function startAction(kind, description) {
    const id = nextId++;
    emit({ id, event: "call", thread_id: 1, layer: "browser", timestamp: now(), defined_class: "Browser", method_id: kind, static: true, labels: ["mapa.user-action"], parameters: [{ name: "target", class: "Element", value: description }] });
    const frame = { id, parent: null, interaction: id };
    pending.set(id, { count: 0, timer: null, callId: id, t0: performance.now(), frame });
    touch(id, 0);
    lastOpenAction = frame;
    return frame;
  }
  function enter(frame) {
    actionFrame = frame;
    current = frame;
    // React dispatches synchronously after our capture listener; clear afterwards.
    setTimeout(() => { if (current === frame) current = null; actionFrame = null; }, 0);
  }
  function onAction(kind) {
    return (ev) => {
      if (!enabled) return;
      const el = ev.target;
      if (el?.closest?.("[data-mapa-ui]")) return;
      enter(startAction(kind, describeTarget(el)));
    };
  }
  // Typing: one "type" action per field, extended while keystrokes keep coming (<1s apart).
  let typing = null;
  window.addEventListener("input", (ev) => {
    if (!enabled) return;
    const el = ev.target;
    const p = typing && pending.get(typing.frame.id);
    if (typing && typing.el === el && p) {
      touch(typing.frame.id, 0);
      lastOpenAction = typing.frame;
      enter(typing.frame);
      return;
    }
    const tag = el.tagName?.toLowerCase();
    const label = `${tag}${el.id ? "#" + el.id : ""}${el.type === "password" ? " (senha)" : ""}`;
    typing = { el, frame: startAction("type", label) };
    enter(typing.frame);
  }, true);
  // Navigation: page load and client-side route changes (Next router uses pushState).
  function navigated(how) {
    if (!enabled) return;
    enter(startAction("navigate", `${how} ${location.pathname}${location.search}`));
  }
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function (...a) {
      const before = location.href;
      const res = orig.apply(this, a);
      if (location.href !== before) navigated(m === "pushState" ? "push" : "replace");
      return res;
    };
  }
  window.addEventListener("popstate", () => navigated("back/forward"));
  navigated("load");
  window.addEventListener("click", onAction("click"), true);
  window.addEventListener("submit", onAction("submit"), true);

  // ---- fetch ----
  window.fetch = function mapaFetch(input, init) {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
    if (!enabled || url.origin === COLLECTOR) return originalFetch(input, init);
    let parent = current;
    let attribution = "exact";
    // If the current frame is only the user action (or nothing), the real caller is
    // probably an async function of that action suspended on an await: infer it.
    const isActionRoot = parent && parent.parent === null && parent.id === parent.interaction;
    if (!parent || isActionRoot) {
      const interaction = parent ? parent.interaction : null;
      const candidates = [...suspended].filter((f) => interaction === null || f.interaction === interaction);
      const inferred = candidates[candidates.length - 1];
      if (inferred) { parent = inferred; attribution = "inferred"; }
      else if (!parent) { parent = actionFrame || lastOpenAction; attribution = parent ? "inferred" : "orphan"; }
      else attribution = "action";
    }
    stats[{ exact: "fetchExact", inferred: "fetchInferred", action: "fetchActionOnly", orphan: "fetchOrphan" }[attribution]] = (stats[{ exact: "fetchExact", inferred: "fetchInferred", action: "fetchActionOnly", orphan: "fetchOrphan" }[attribution]] || 0) + 1;
    const id = nextId++;
    const method = (init?.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    const message = [...url.searchParams].map(([name, value]) => ({ name, class: "String", value: summarize(/token|key|secret|pass/i.test(name) ? "[mascarado]" : maskText(value)) }));
    if (init?.body && typeof init.body === "string") message.push({ name: "body", class: "String", kind: "body", value: summarize(maskText(init.body)) });
    const headers = new Headers(init?.headers || (typeof input === "object" ? input.headers : undefined));
    if (url.origin === location.origin) headers.set("traceparent", `00-${session}-${id.toString(16).padStart(16, "0")}-01`);
    const supabase = url.hostname.endsWith(".supabase.co") ? { ...identityFromHeaders(headers) } : undefined;
    emit({ id, event: "call", thread_id: 1, layer: "browser", timestamp: now(), parent_id: parent?.id, attribution, supabase, http_client_request: { request_method: method, url: url.origin + url.pathname, headers: { traceparent: headers.get("traceparent") || undefined } }, message });
    const interaction = parent?.interaction;
    if (interaction) touch(interaction, +1);
    const t0 = performance.now();
    const p = originalFetch(input, { ...init, headers });
    p.then(
      async (res) => {
        let body = "";
        try { body = await res.clone().text(); } catch {}
        emit({ id: nextId++, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, http_client_response: { status_code: res.status, return_value: { class: "String", value: summarize(maskText(body)) } } });
        if (interaction) touch(interaction, -1);
      },
      (e) => {
        emit({ id: nextId++, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, exceptions: [{ class: "TypeError", message: String(e) }] });
        if (interaction) touch(interaction, -1);
      },
    );
    return p;
  };

  // ---- WebSocket (Supabase Realtime) ----
  const OriginalWS = window.WebSocket;
  window.WebSocket = class MapaWebSocket extends OriginalWS {
    constructor(wsUrl, protocols) {
      super(wsUrl, protocols);
      const u = new URL(String(wsUrl), location.href);
      if (!enabled || u.port === "3100" || /webpack-hmr|turbopack/.test(u.pathname)) return;
      const parent = current || lastOpenAction;
      const id = nextId++;
      const t0 = performance.now();
      const params = [...u.searchParams].filter(([k]) => k !== "apikey").map(([name, value]) => ({ name, class: "String", value: summarize(value) }));
      emit({ id, event: "call", thread_id: 1, layer: "browser", timestamp: now(), parent_id: parent?.id, labels: ["mapa.websocket"], http_client_request: { request_method: "GET", url: u.origin + u.pathname, headers: { Upgrade: "websocket" } }, message: params });
      this.addEventListener("open", () => emit({ id: nextId++, event: "return", thread_id: 1, parent_id: id, elapsed: (performance.now() - t0) / 1000, http_client_response: { status_code: 101 } }));
      const msg = (direction, data) => {
        let text = typeof data === "string" ? data : "[binary]";
        // Realtime frames carry access_token on join: mask it before summarizing
        text = text.replace(/"(access_token|apikey)"\s*:\s*"[^"]*"/g, '"$1":"[mascarado]"');
        emit({ id: nextId++, event: "call", thread_id: 1, layer: "browser", timestamp: now(), parent_id: id, defined_class: "Realtime", method_id: direction, static: true, labels: ["mapa.websocket"], message: [{ name: "frame", class: "String", value: summarize(text) }] });
      };
      const send = this.send.bind(this);
      this.send = (data) => { msg("send", data); return send(data); };
      this.addEventListener("message", (ev) => msg("receive", ev.data));
    }
  };

  window.addEventListener("error", (ev) => emit({ id: nextId++, event: "call", thread_id: 1, layer: "browser", timestamp: now(), defined_class: "Browser", method_id: "error", static: true, labels: ["mapa.error"], parameters: [{ name: "message", class: "String", value: summarize(ev.message) }] }));

  // ---- transport ----
  setInterval(() => {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    originalFetch(`${COLLECTOR}/events?source=browser-${session}`, { method: "POST", body: JSON.stringify(batch), keepalive: batch.length < 500 }).catch(() => {});
  }, 500);

  window.addEventListener("pagehide", () => {
    if (queue.length) navigator.sendBeacon(`${COLLECTOR}/events?source=browser-${session}`, JSON.stringify(queue));
    queue = [];
  });

  globalThis.__mapa = { r, cur: () => current, bf, af, setEnabled: (v) => (enabled = v) };
}
