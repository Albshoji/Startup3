import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAppMap, buildClassMap, linearize, pruneAppMap, validateRecording } from "../dist/index.js";

const metadata = { client: { name: "mapa", url: "x" }, recorder: { type: "remote", name: "mapa" } };
const fn = (id, parent_id, method_id, extra = {}) => ({ id, event: "call", thread_id: 1, timestamp: id, parent_id, defined_class: "lib", method_id, path: "lib/x.ts", lineno: 1, static: true, ...extra });
const ret = (id, parent_id) => ({ id, event: "return", thread_id: 1, parent_id, return_value: { class: "string", value: "x".repeat(90) } });

function sample(loopCount) {
  const raw = [fn(1, undefined, "raiz")];
  let id = 2;
  for (let i = 0; i < loopCount; i++) {
    raw.push(fn(id, 1, "repetida", { lineno: 2 }));
    raw.push(ret(id + 1, id));
    id += 2;
  }
  raw.push(fn(id, 1, "importante", { lineno: 3 }), ret(id + 1, id), ret(id + 2, 1));
  const { events } = linearize([{ source: "s", events: raw }]);
  return buildAppMap(metadata, events, buildClassMap(events));
}

test("own validator accepts a good file and points out structural errors", () => {
  assert.deepEqual(validateRecording(sample(3)), { errors: [], warnings: [] });
  const broken = sample(1);
  broken.events = [...broken.events].reverse();
  assert.ok(validateRecording(broken).errors.length > 0);
  assert.ok(validateRecording({ version: "1", metadata: {}, classMap: [] }).errors.includes("`events` não é uma lista"));
  const withParent = sample(1);
  withParent.events[0].parent_id = 9;
  assert.match(validateRecording(withParent).errors[0], /parent_id/);
});

test("pruning removes the largest function until the file fits, keeps the order valid and reports it", () => {
  const big = sample(200);
  const size = JSON.stringify(big).length;
  const { appmap, pruned } = pruneAppMap(big, Math.floor(size / 3));
  assert.deepEqual(pruned.map((p) => [p.function, p.removed_calls]), [["lib.repetida", 200]]);
  assert.ok(JSON.stringify(appmap).length < size / 3);
  assert.ok(appmap.events.some((e) => e.method_id === "importante"));
  assert.deepEqual(validateRecording(appmap).errors, []);
  assert.deepEqual(pruneAppMap(sample(2)).pruned, [], "small files are untouched");
});
