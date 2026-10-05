// SPIKE (Etapa 0) — Next.js server recorder. Installs globalThis.__mapa once per process.
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import { summarize, classOf } from "./summarize.js";
import { maskText, maskSummary } from "./mask.js";
import { identityFromHeaders } from "./supabase-identity.js";

function ok(v) { return { v }; }
function err(e) { return { e, failed: true }; }
function unbox(box) { if (box.failed) throw box.e; return box.v; }

if (!globalThis.__mapa) install();

function install() {
  const als = new AsyncLocalStorage();
  let nextId = 1;
  let nextThread = 2; // 1 = browser
  let queue = [];
  const stats = { calls: 0, fetchWithParent: 0, fetchOrphan: 0, requests: 0, alsRuns: 0 };
  globalThis.__mapaServerStats = stats;
  const now = () => Date.now() / 1000;
  const emit = (e) => queue.push(e);

  const param = (v, name) => ({ name, class: classOf(v), value: maskSummary(name, summarize(v)) });

  function r(thisArg, fn, args, meta) {
    const parent = als.getStore();
    const id = nextId++;
    const thread = parent ? parent.thread : 0;
    stats.calls++;
    emit({
      id, event: "call", thread_id: thread, layer: "next-server", timestamp: now(),
      parent_id: parent?.id, defined_class: meta.klass, method_id: meta.id, path: meta.path,
      lineno: meta.lineno, static: thisArg === undefined, labels: meta.labels,
      parameters: Array.from(args, (a, i) => param(a, meta.params[i] || `arg${i}`)),
    });
    const t0 = performance.now();
    let result;
    try {
      stats.alsRuns++;
      result = als.run({ id, thread }, () => fn.apply(thisArg, args));
    } catch (e) {
      emit({ id: nextId++, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, exceptions: [{ class: e?.name || "Error", message: String(e?.message || e) }] });
      throw e;
    }
    const retId = nextId++;
    if (result && typeof result.then === "function") {
      Promise.resolve(result).then(
        (v) => emit({ id: retId, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, return_value: param(v) }),
        (e) => emit({ id: retId, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, exceptions: [{ class: e?.name || "Error", message: String(e?.message || e) }] }),
      );
    } else emit({ id: retId, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, return_value: param(result) });
    return result;
  }

  // ---- incoming requests ----
  const IGNORE = /^\/(_next\/(static|image|webpack-hmr)|__nextjs|favicon\.ico)/;
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, req, res) {
    if (event !== "request" || IGNORE.test(req.url || "")) return originalEmit.apply(this, arguments);
    const thread = nextThread++;
    const id = nextId++;
    stats.requests++;
    const url = new URL(req.url, "http://x");
    const tp = req.headers.traceparent;
    const browserParent = tp ? parseInt(tp.split("-")[2], 16) : undefined;
    const browserSession = tp ? tp.split("-")[1] : undefined;
    emit({ id, event: "call", thread_id: thread, layer: "next-server", timestamp: now(), browser_parent_id: browserParent, browser_session: browserSession, http_server_request: { request_method: req.method, path_info: url.pathname, headers: { "next-action": req.headers["next-action"], rsc: req.headers.rsc } }, message: [...url.searchParams].map(([name, value]) => ({ name, class: "String", value: summarize(value) })) });
    const t0 = performance.now();
    res.once("finish", () => emit({ id: nextId++, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, http_server_response: { status_code: res.statusCode } }));
    return als.run({ id, thread }, () => originalEmit.apply(this, arguments));
  };

  // ---- outgoing fetch ----
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function mapaFetch(input, init) {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    const parent = als.getStore();
    if (parent) stats.fetchWithParent++; else stats.fetchOrphan++;
    const thread = parent ? parent.thread : 0;
    const id = nextId++;
    const method = (init?.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    const supabase = url.hostname.endsWith(".supabase.co") ? { ...identityFromHeaders(new Headers(init?.headers || (typeof input === "object" ? input.headers : undefined))) } : undefined;
    emit({ id, event: "call", thread_id: thread, layer: "next-server", timestamp: now(), parent_id: parent?.id, supabase, http_client_request: { request_method: method, url: url.origin + url.pathname }, message: [...url.searchParams].map(([name, value]) => ({ name, class: "String", value: summarize(value) })) });
    const t0 = performance.now();
    const p = originalFetch.call(this, input, init);
    p.then(
      async (res) => {
        let body = "";
        try { body = await res.clone().text(); } catch {}
        emit({ id: nextId++, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, http_client_response: { status_code: res.status, headers: { "sb-request-id": res.headers.get("sb-request-id") || undefined }, return_value: { class: "String", value: summarize(maskText(body)) } } });
      },
      (e) => emit({ id: nextId++, event: "return", thread_id: thread, parent_id: id, elapsed: (performance.now() - t0) / 1000, exceptions: [{ class: "TypeError", message: String(e) }] }),
    );
    return p;
  };

  // ---- transport ----
  const timer = setInterval(() => {
    if (queue.length === 0) return;
    const body = JSON.stringify(queue);
    queue = [];
    const req = http.request({ host: "localhost", port: 47100, path: "/events?source=server", method: "POST", headers: { "content-type": "application/json" } });
    req.on("error", () => {});
    req.end(body);
  }, 500);
  timer.unref?.();

  globalThis.__mapa = {
    r,
    cur: () => als.getStore() || null,
    bf: (x) => Promise.resolve(x).then(ok, err),
    af: (_frame, box) => unbox(box),
  };
}
