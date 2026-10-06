import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildAppMap, buildClassMap, linearize } from "../dist/index.js";

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
