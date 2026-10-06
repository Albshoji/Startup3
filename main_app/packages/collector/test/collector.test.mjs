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
  const collector = await startCollector({ projectRoot: root, metadata, port: 0, ...options });
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
    const appmap = await readAppMap(join(savedLine.replace("Gravação salva em ", ""), "recording.appmap.json.gz"));
    assert.equal(appmap.metadata.mapa.stopped_by, "time-limit");
    assert.doesNotThrow(() => validateAppMap(appmap));
  });
});

test("closing the collector during a recording saves it", async () => {
  const root = await mkdtemp(join(tmpdir(), "mapa-collector-"));
  const collector = await startCollector({ projectRoot: root, metadata, port: 0 });
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
