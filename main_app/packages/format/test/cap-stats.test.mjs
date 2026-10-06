import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildAppMap, buildClassMap, CallCap, computeStats, linearize, omittedCall, sweepEvents } from "../dist/index.js";

const require = createRequire(import.meta.url);
const { validate } = require("@appland/appmap-validate");
const meta = { id: "somar", klass: "precos", path: "lib/precos.ts", lineno: 22, static: true, async: false, params: ["a", "b"], labels: [], pkg: 0, shallow: false };

test("ceiling: up to N calls per function are admitted, the rest counted once", () => {
  const cap = new CallCap(3);
  const admitted = Array.from({ length: 10 }, (_, i) => cap.admit(meta, 7, i));
  assert.deepEqual(admitted, [true, true, true, false, false, false, false, false, false, false]);
  cap.noteOmitted({ ...meta, id: "dobrar", lineno: 30 }, 7, 5);
  const taken = cap.take();
  assert.deepEqual(taken.map((t) => [t.meta.id, t.omitted, t.parentId, t.timestamp]), [["somar", 7, 7, 3], ["dobrar", 1, 7, 5]]);
  assert.deepEqual(cap.take(), [], "reported once");
});

test("Mapa.omitted is a valid call; stats add omitted calls and suggest exclusions above 75", () => {
  const events = [];
  let id = 1;
  events.push({ id: id++, event: "call", thread_id: 1, timestamp: 1, defined_class: "LoopButton", method_id: "rodarLoop", path: "components/LoopButton.tsx", lineno: 9, static: true });
  for (let i = 0; i < 50; i++) {
    events.push({ id: id++, event: "call", thread_id: 1, timestamp: 1, parent_id: 1, defined_class: "precos", method_id: "somar", path: "lib/precos.ts", lineno: 22, static: true, parameters: [] });
    events.push({ id: id++, event: "return", thread_id: 1, parent_id: id - 2, return_value: { class: "number", value: "1" } });
  }
  events.push(omittedCall({ meta, omitted: 9950, parentId: 1, timestamp: 1.5 }, { id: id++, thread_id: 1, layer: "browser" }));
  events.push({ id: id++, event: "return", thread_id: 1, parent_id: id - 2, return_value: { class: "Number", value: "9950" } });
  events.push({ id: id++, event: "return", thread_id: 1, parent_id: 1 });
  const linear = linearize([{ source: "b", events }]).events;
  const appmap = buildAppMap({ client: { name: "mapa", url: "x" }, recorder: { type: "remote", name: "mapa" } }, linear, buildClassMap(linear));
  assert.doesNotThrow(() => validate({ ...appmap, version: "1.13.1" }));
  const stats = computeStats(appmap);
  const somar = stats.functions[0];
  assert.deepEqual([somar.function, somar.location, somar.count, somar.omitted, somar.exclude], ["precos.somar", "lib/precos.ts:22", 50, 9950, "somar"]);
  assert.ok(somar.size > 0);
  assert.deepEqual(stats.suggestions.map((s) => s.exclude), ["somar"]);
});

test("final sweep: values cut to 100, secrets masked, secret headers removed", () => {
  const events = [
    { id: 1, event: "call", thread_id: 1, defined_class: "a", method_id: "b", static: true, parameters: [{ name: "x", class: "String", value: "y".repeat(300) }, { name: "senha", class: "String", value: "abc" }], http_client_request: undefined },
    { id: 2, event: "call", thread_id: 1, http_client_request: { request_method: "GET", url: "u", headers: { authorization: "Bearer x", "content-type": "a" } }, message: [{ name: "q", class: "String", value: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln" }] },
  ];
  sweepEvents(events);
  assert.equal(events[0].parameters[0].value.length, 100);
  assert.equal(events[0].parameters[1].value, "[mascarado]");
  assert.deepEqual(events[1].http_client_request.headers, { "content-type": "a" });
  assert.equal(events[1].message[0].value, "[token]");
});
