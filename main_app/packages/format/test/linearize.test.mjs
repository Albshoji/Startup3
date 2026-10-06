import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildAppMap, buildClassMap, buildInteractions, linearize } from "../dist/index.js";

const require = createRequire(import.meta.url);
const { validate } = require("@appland/appmap-validate");
const metadata = { client: { name: "mapa", url: "x" }, recorder: { type: "remote", name: "mapa" } };

const call = (id, parent_id, method_id, timestamp, extra = {}) => ({
  id, event: "call", thread_id: 1, parent_id, defined_class: "AddItem", method_id, path: "components/AddItem.tsx", lineno: id, static: true, timestamp, ...extra,
});
const ret = (id, parent_id) => ({ id, event: "return", thread_id: 1, parent_id, elapsed: 0.001 });

test("interleaved async events become a valid AppMap with per-thread FIFO order", () => {
  // Two async handlers run at the same time in the browser; their events interleave.
  const browser = [
    call(1, undefined, "adicionarItem", 1),
    call(2, undefined, "outroHandler", 2),
    call(3, 1, "formatarPreco", 3), // after adicionarItem's await
    ret(4, 3),
    ret(5, 2),
    ret(6, 1),
  ];
  // The server numbers its events on its own (ids collide with the browser's).
  const server = [
    { ...call(1, undefined, "alterarItem", 1.5), thread_id: 7, path: "app/actions.ts", defined_class: "actions" },
    { ...call(2, 1, "criarClienteServidor", 1.6), thread_id: 7, path: "lib/supabase-server.ts", defined_class: "supabase-server" },
    { ...ret(3, 2), thread_id: 7 },
    { ...ret(4, 1), thread_id: 7 },
  ];
  const { events, incomplete } = linearize([{ source: "browser-a", events: browser }, { source: "server", events: server }]);
  assert.equal(incomplete, 0);
  assert.deepEqual(
    events.map((e) => (e.event === "call" ? e.method_id : `/${e.parent_id}`)),
    ["adicionarItem", "formatarPreco", "/2", "/1", "alterarItem", "criarClienteServidor", "/6", "/5", "outroHandler", "/9"],
  );
  assert.deepEqual(events.map((e) => e.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(events.filter((e) => e.event === "call").every((e) => !("parent_id" in e)), "no parent_id on calls (schema)");
  assert.equal(events[0].thread_id, events[1].thread_id);
  assert.notEqual(events[4].thread_id, events[0].thread_id, "server gets its own thread");
  const appmap = buildAppMap(metadata, events, buildClassMap(events));
  assert.doesNotThrow(() => validate({ ...appmap, version: "1.13.1" }));
});

test("calls without return get a synthetic return; orphan returns are dropped", () => {
  const { events, incomplete } = linearize(
    [{ source: "s", events: [ret(1, 99), call(2, 99, "f", 10), call(3, 2, "g", 11), ret(4, 3)] }],
    12,
  );
  assert.equal(incomplete, 1);
  assert.equal(events.length, 4);
  assert.equal(events[0].method_id, "f", "parent started before Start: becomes a root");
  assert.deepEqual(events[3], { id: 4, event: "return", thread_id: 1, parent_id: 1, incomplete: true, elapsed: 2 });
});

test("classMap groups functions by folder and class, without duplicates", () => {
  const events = [call(1, undefined, "adicionarItem", 1), ret(2, 1), call(3, undefined, "adicionarItem", 2), ret(4, 3)];
  events[2].lineno = 1;
  events[0].labels = ["mapa.event-handler"];
  assert.deepEqual(buildClassMap(events), [
    {
      type: "package",
      name: "components",
      children: [
        {
          type: "class",
          name: "AddItem",
          children: [{ type: "function", name: "adicionarItem", location: "components/AddItem.tsx:1", static: true, labels: ["mapa.event-handler"] }],
        },
      ],
    },
  ]);
});

test("browser fetch → server request: remote link resolved to final ids; interactions count both sides", () => {
  const tab = "browser-" + "a".repeat(32);
  const browser = [
    { id: 1, event: "call", thread_id: 1, timestamp: 10, defined_class: "Browser", method_id: "click", path: "mapa:browser", static: true, labels: ["mapa.user-action"], parameters: [{ name: "target", class: "Element", value: 'button#adicionar "Adicionar"' }] },
    { id: 2, event: "call", thread_id: 1, timestamp: 10.1, parent_id: 1, http_client_request: { request_method: "POST", url: "http://localhost:3000/" }, message: [] },
    { id: 3, event: "return", thread_id: 1, parent_id: 2, elapsed: 0.2, http_client_response: { status_code: 200 } },
    { id: 4, event: "return", thread_id: 1, parent_id: 1, elapsed: 0.3 },
  ];
  const server = [
    { id: 1, event: "call", thread_id: 5, timestamp: 10.15, remote_parent: { source: tab, id: 2 }, http_server_request: { request_method: "POST", path_info: "/" }, message: [] },
    { id: 2, event: "call", thread_id: 5, timestamp: 10.16, parent_id: 1, defined_class: "actions", method_id: "alterarItem", path: "app/actions.ts", lineno: 5, static: true },
    { id: 3, event: "return", thread_id: 5, parent_id: 2, elapsed: 0.01 },
    { id: 4, event: "return", thread_id: 5, parent_id: 1, elapsed: 0.05, http_server_response: { status_code: 200 } },
  ];
  const { events } = linearize([{ source: tab, events: browser }, { source: "server-1", events: server }]);
  const request = events.find((e) => e.http_server_request);
  const fetchCall = events.find((e) => e.http_client_request);
  assert.equal(request.remote_parent_id, fetchCall.id);
  assert.ok(!("remote_parent" in request));
  assert.doesNotThrow(() => validate({ ...buildAppMap(metadata, events, buildClassMap(events)), version: "1.13.1" }));
  const [interaction] = buildInteractions(events);
  assert.deepEqual(interaction, { event_id: 1, kind: "click", target: 'button#adicionar "Adicionar"', started_at: 10, ended_at: 10.3, event_count: 8 });
});

test("an unfinished HTTP call gets a valid status (599) and is marked incomplete", () => {
  const { events } = linearize([{ source: "s", events: [{ id: 1, event: "call", thread_id: 1, timestamp: 1, http_client_request: { request_method: "GET", url: "https://x.supabase.co/rest/v1/items" }, message: [] }] }], 2);
  assert.deepEqual(events[1].http_client_response, { status_code: 599 });
  assert.equal(events[1].incomplete, true);
  assert.doesNotThrow(() => validate({ ...buildAppMap(metadata, events), version: "1.13.1" }));
});

test("the server request that served a page load is tied to the browser's load action (inferred)", () => {
  const tab = "browser-" + "b".repeat(32);
  const browser = [
    { id: 1, event: "call", thread_id: 1, timestamp: 100, defined_class: "Browser", method_id: "navigate", path: "mapa:browser", static: true, labels: ["mapa.user-action"], parameters: [{ name: "target", class: "Location", value: "carregar /?x=1" }, { name: "url", class: "String", value: "/?x=1" }] },
    { id: 2, event: "return", thread_id: 1, parent_id: 1, elapsed: 1 },
  ];
  const server = [
    { id: 1, event: "call", thread_id: 1, timestamp: 100.05, http_server_request: { request_method: "GET", path_info: "/", headers: { accept: "text/html,*/*" } }, message: [] },
    { id: 2, event: "return", thread_id: 1, parent_id: 1, http_server_response: { status_code: 200 } },
    { id: 3, event: "call", thread_id: 2, timestamp: 100.06, http_server_request: { request_method: "GET", path_info: "/favicon.svg", headers: { accept: "image/*" } }, message: [] },
    { id: 4, event: "return", thread_id: 2, parent_id: 3, http_server_response: { status_code: 200 } },
  ];
  const { events } = linearize([{ source: tab, events: browser }, { source: "server-1", events: server }]);
  const [page, image] = events.filter((e) => e.http_server_request);
  assert.equal(page.remote_parent_id, 1);
  assert.equal(page.attribution, "inferred");
  assert.equal(image.remote_parent_id, undefined);
  assert.equal(buildInteractions(events)[0].event_count, 4);
});

test("exception object ids are renumbered per source (same error keeps one id, sources never collide)", () => {
  const err = (id, parent, object_id) => ({ id, event: "return", thread_id: 1, parent_id: parent, exceptions: [{ class: "Error", message: "x", object_id }] });
  const { events } = linearize([
    { source: "a", events: [call(1, undefined, "f", 1), call(2, 1, "g", 2), err(3, 2, 1), err(4, 1, 1)] },
    { source: "b", events: [call(1, undefined, "h", 3), err(2, 1, 1)] },
  ]);
  const ids = events.filter((e) => e.exceptions).map((e) => e.exceptions[0].object_id);
  assert.deepEqual(ids, [1, 1, 2]);
});
