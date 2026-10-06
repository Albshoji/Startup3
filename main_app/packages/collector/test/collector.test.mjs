import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import http from "node:http";
import { createRequire } from "node:module";
import { startCollector } from "../dist/index.js";

const require = createRequire(import.meta.url);
const { validate } = require("@appland/appmap-validate");
// The validator stops at schema 1.13.1 and checks the `version` value; Mapa writes 1.14
// (only adds optional metadata), so a copy with version 1.13.1 is validated.
const validateAppMap = (appmap) => validate({ ...appmap, version: "1.13.1" });

const metadata = () => ({
  app: "demo",
  language: { name: "javascript", engine: "Node.js", version: process.version },
  client: { name: "mapa", url: "https://github.com/Albshoji/Startup3", version: "0.0.0" },
  recorder: { type: "remote", name: "mapa" },
});

async function withCollector(options, fn) {
  const root = await mkdtemp(join(tmpdir(), "mapa-collector-"));
  const collector = await startCollector({ projectRoot: root, metadata, port: 0, drainMs: 0, ...options });
  try {
    await fn(collector, root);
  } finally {
    await collector.close();
    await rm(root, { recursive: true, force: true });
  }
}

const call = (collector, method, body) =>
  fetch(`${collector.url}/record`, { method, body: body ? JSON.stringify(body) : undefined });

async function readAppMap(file) {
  return JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
}

test("start/stop over HTTP saves a valid AppMap with the folder layout of CLAUDE.md §9.4", async () => {
  await withCollector({}, async (collector, root) => {
    assert.deepEqual((await (await call(collector, "GET")).json()).enabled, false);

    const started = await call(collector, "POST", { name: "Adicionar item" });
    assert.equal(started.status, 200);
    assert.equal((await started.json()).enabled, true);

    assert.equal((await call(collector, "POST")).status, 409, "second start is refused");

    const stopped = await call(collector, "DELETE");
    assert.equal(stopped.status, 200);
    const saved = await stopped.json();
    assert.ok(saved.directory.startsWith(join(root, ".mapa", "recordings")));
    assert.match(saved.directory, /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-adicionar-item$/);
    assert.equal(saved.stopped_by, "user");

    const appmap = await readAppMap(saved.file);
    assert.doesNotThrow(() => validateAppMap(appmap));
    assert.equal(appmap.version, "1.14");
    assert.equal(appmap.metadata.name, "Adicionar item");
    assert.equal(appmap.metadata.mapa.stopped_by, "user");
    assert.deepEqual(JSON.parse(await readFile(join(saved.directory, "interactions.json"), "utf8")), []);

    assert.equal((await call(collector, "DELETE")).status, 404, "stop without recording");
  });
});

test("stops by itself at the time limit and keeps what was recorded", async () => {
  const messages = [];
  await withCollector({ limits: { maxSeconds: 0.3 }, log: (m) => messages.push(m) }, async (collector) => {
    await call(collector, "POST");
    await new Promise((r) => setTimeout(r, 700));
    const status = await (await call(collector, "GET")).json();
    assert.equal(status.enabled, false);
    assert.ok(messages.some((m) => m.includes("limite de 0.3 segundos")), messages.join("\n"));
    const savedLine = messages.find((m) => m.startsWith("Gravação salva em "));
    assert.ok(savedLine);
    const appmap = await readAppMap(join(savedLine.replace("Gravação salva em ", "").replace(/ \(\d+ eventos\)\.$/, ""), "recording.appmap.json.gz"));
    assert.equal(appmap.metadata.mapa.stopped_by, "time-limit");
    assert.doesNotThrow(() => validateAppMap(appmap));
  });
});

test("closing the collector during a recording saves it", async () => {
  const root = await mkdtemp(join(tmpdir(), "mapa-collector-"));
  const collector = await startCollector({ projectRoot: root, metadata, port: 0, drainMs: 0 });
  collector.start();
  await collector.close();
  const { readdir } = await import("node:fs/promises");
  const [folder] = await readdir(join(root, ".mapa", "recordings"));
  const appmap = await readAppMap(join(root, ".mapa", "recordings", folder, "recording.appmap.json.gz"));
  assert.equal(appmap.metadata.mapa.stopped_by, "shutdown");
  await rm(root, { recursive: true, force: true });
});

test("refuses requests whose Host header is not local", async () => {
  await withCollector({}, async (collector) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${collector.url}/record`, { method: "POST", headers: { host: "evil.example" } }, (res) => resolve(res.statusCode));
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
    assert.equal(collector.status().enabled, false);
  });
});

const sendEvents = (collector, source, events, headers = {}) =>
  fetch(`${collector.url}/events?source=${source}`, { method: "POST", body: JSON.stringify(events), headers: { "content-type": "text/plain", ...headers } });

const fnCall = (id, parent_id, method_id, timestamp, thread_id = 1) => ({
  id, event: "call", thread_id, timestamp, parent_id, defined_class: "AddItem", method_id, path: "components/AddItem.tsx", lineno: 10 + id, static: true,
});
const fnReturn = (id, parent_id, thread_id = 1) => ({ id, event: "return", thread_id, parent_id, elapsed: 0.01 });

test("events from browser tabs and server are joined into one valid AppMap with a classMap", async () => {
  await withCollector({}, async (collector) => {
    assert.equal((await sendEvents(collector, "browser-a", [fnCall(1, undefined, "ignorado", 1)])).status, 204, "accepted but ignored when not recording");
    collector.start("cenario");
    await sendEvents(collector, "browser-a", [fnCall(1, undefined, "adicionarItem", 1), fnCall(2, 1, "formatarPreco", 2)]);
    await sendEvents(collector, "server-1", [fnCall(1, undefined, "alterarItem", 1.5, 3), fnReturn(2, 1, 3)]);
    await sendEvents(collector, "browser-a", [fnReturn(3, 2), fnReturn(4, 1)]);
    const saved = await collector.stop();
    const appmap = await readAppMap(saved.file);
    assert.doesNotThrow(() => validateAppMap(appmap));
    assert.deepEqual(appmap.events.map((e) => e.method_id ?? `/${e.parent_id}`), ["adicionarItem", "formatarPreco", "/2", "/1", "alterarItem", "/5"]);
    assert.equal(appmap.classMap[0].name, "components");
    assert.equal(saved.event_count, 6);
  });
});

test("Stop waits for the last batches still on their way (drain)", async () => {
  await withCollector({ drainMs: 300 }, async (collector) => {
    collector.start();
    const stopping = collector.stop();
    await sendEvents(collector, "browser-a", [fnCall(1, undefined, "tarde", 1), fnReturn(2, 1)]);
    const appmap = await readAppMap((await stopping).file);
    assert.equal(appmap.events.length, 2);
  });
});

test("unfinished calls get a synthetic return and are counted", async () => {
  await withCollector({}, async (collector) => {
    collector.start();
    await sendEvents(collector, "browser-a", [fnCall(1, undefined, "esperando", Date.now() / 1000)]);
    const appmap = await readAppMap((await collector.stop()).file);
    assert.equal(appmap.metadata.mapa.incomplete_calls, 1);
    assert.equal(appmap.events[1].incomplete, true);
    assert.doesNotThrow(() => validateAppMap(appmap));
  });
});

test("event limit is strict: a big batch is cut at the limit; cut calls get a synthetic return", async () => {
  await withCollector({ limits: { maxEvents: 3 } }, async (collector) => {
    collector.start();
    await sendEvents(collector, "s", [fnCall(1, undefined, "a", 1), fnCall(2, 1, "b", 2), fnReturn(3, 2), fnReturn(4, 1), fnCall(5, undefined, "c", 3), fnReturn(6, 5)]);
    await new Promise((r) => setTimeout(r, 200));
    const status = collector.status();
    assert.equal(status.last.stopped_by, "event-limit");
    const appmap = await readAppMap(join(status.last.directory, "recording.appmap.json.gz"));
    assert.deepEqual(appmap.events.map((e) => e.method_id ?? (e.incomplete ? "incompleto" : "ret")), ["a", "b", "ret", "incompleto"]);
    assert.doesNotThrow(() => validateAppMap(appmap));
  });
});

test("stops at the event limit and keeps what was recorded", async () => {
  const messages = [];
  await withCollector({ limits: { maxEvents: 3 }, log: (m) => messages.push(m) }, async (collector) => {
    collector.start();
    await sendEvents(collector, "s", [fnCall(1, undefined, "a", 1), fnReturn(2, 1), fnCall(3, undefined, "b", 2), fnReturn(4, 3)]);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(collector.status().enabled, false);
    assert.ok(messages.some((m) => m.includes("limite de 3 eventos")));
    assert.ok(messages.some((m) => m.startsWith("Gravação salva em ")));
  });
});

test("CORS only for local origins; other sites are refused", async () => {
  await withCollector({}, async (collector) => {
    const ok = await fetch(`${collector.url}/record`, { headers: { origin: "http://localhost:3000" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const evil = await sendEvents(collector, "x", [], { origin: "https://evil.example" });
    assert.equal(evil.status, 403);
  });
});

test("size limit (MB) is strict: stops and keeps what fit; status reports bytes and the last recording", async () => {
  await withCollector({ limits: { maxMegabytes: 0.0012 } }, async (collector) => {
    collector.start();
    await sendEvents(collector, "s", [fnCall(1, undefined, "a".repeat(600), 1), fnReturn(2, 1)]);
    assert.ok(collector.status().bytes > 600);
    await sendEvents(collector, "s", [fnCall(3, undefined, "b".repeat(600), 2), fnReturn(4, 3)]);
    await new Promise((r) => setTimeout(r, 200));
    const status = collector.status();
    assert.equal(status.enabled, false);
    assert.equal(status.last.stopped_by, "size-limit");
    assert.equal(status.last.event_count, 2, "only the first pair fit");
    const appmap = await readAppMap(join(status.last.directory, "recording.appmap.json.gz"));
    assert.doesNotThrow(() => validateAppMap(appmap));
  });
});

test("the saved file is marked as trimmed to 100 characters and passes the final sweep", async () => {
  await withCollector({}, async (collector) => {
    collector.start();
    const call = { ...fnCall(1, undefined, "f", 1), parameters: [{ name: "senha", class: "String", value: "segredo" }] };
    await sendEvents(collector, "s", [call, fnReturn(2, 1)]);
    const appmap = await readAppMap((await collector.stop()).file);
    assert.equal(appmap.metadata.trimmed.max_length, 100);
    assert.equal(appmap.events[0].parameters[0].value, "[mascarado]");
    assert.doesNotThrow(() => validateAppMap(appmap));
  });
});

test("the browser can start and stop (CORS preflight allows POST and DELETE from the app)", async () => {
  await withCollector({}, async (collector) => {
    const preflight = await fetch(`${collector.url}/record`, { method: "OPTIONS", headers: { origin: "http://localhost:3000", "access-control-request-method": "DELETE" } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
  });
});
