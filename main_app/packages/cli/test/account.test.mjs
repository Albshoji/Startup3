import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Fake Mapa site implementing the CLI API (device login, recordings, signed uploads). */
async function fakeSite() {
  const state = { polls: 0, approved: false, uploads: {}, completed: [], tokens: new Set(), revoked: new Set(), created: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const auth = (req.headers.authorization ?? "").replace("Bearer ", "");
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/cli/device") return json(200, { device_code: "dev-123", user_code: "ABCD-2345", verification_uri: `${base}/dispositivo`, verification_uri_complete: `${base}/dispositivo?codigo=ABCD-2345`, expires_in: 30, interval: 1 });
    if (url.pathname === "/api/cli/token") {
      state.polls++;
      if (state.polls < 2) return json(400, { error: "authorization_pending", message: "esperando" });
      const token = `mapa_${"x".repeat(30)}`;
      state.tokens.add(token);
      return json(200, { token, email: "maria@exemplo.com" });
    }
    const valid = state.tokens.has(auth) && !state.revoked.has(auth);
    if (url.pathname === "/api/cli/me") return valid ? json(200, { email: "maria@exemplo.com" }) : json(401, { error: "unauthorized", message: "não conectado" });
    if (url.pathname === "/api/cli/logout") {
      state.revoked.add(auth);
      return json(200, { ok: true });
    }
    // signed upload URLs need no token
    if (url.pathname.startsWith("/upload/") && req.method === "PUT") {
      state.uploads[url.pathname.slice(8)] = { bytes: raw.length, type: req.headers["content-type"] };
      return json(200, { Key: url.pathname });
    }
    if (!valid) return json(401, { error: "unauthorized", message: "não conectado" });
    if (url.pathname === "/api/cli/recordings") {
      const body = JSON.parse(raw.toString());
      state.created.push(body);
      return json(200, {
        id: "rec-1",
        url: `${base}/gravacoes/rec-1`,
        uploads: [
          { file: "recording.appmap.json.gz", url: `${base}/upload/recording.appmap.json.gz?token=t`, content_type: "application/gzip" },
          { file: "interactions.json", url: `${base}/upload/interactions.json?token=t`, content_type: "application/json" },
        ],
      });
    }
    if (url.pathname === "/api/cli/recordings/rec-1/complete") {
      state.completed.push("rec-1");
      return json(200, { id: "rec-1", status: "recebida", url: `${base}/gravacoes/rec-1` });
    }
    json(404, { error: "not_found", message: "?" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, state, close: () => new Promise((r) => server.close(r)) };
}

test("login (device code), credentials outside the project with private permissions, upload and logout", async () => {
  const site = await fakeSite();
  const config = await mkdtemp(join(tmpdir(), "mapa-config-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "mapa-project-"));
  process.env.MAPA_CONFIG_DIR = config;
  process.env.MAPA_SITE_URL = site.base;
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const { login, logout } = await import("../dist/login.js");
    const { readCredentials } = await import("../dist/account.js");
    const { uploadRecording, uploadConsented } = await import("../dist/upload.js");

    assert.equal(await login(), 0);
    assert.ok(lines.some((l) => l.includes("ABCD-2345")), "shows the short code");
    const creds = readCredentials();
    assert.equal(creds.email, "maria@exemplo.com");
    assert.equal(creds.site, site.base);
    assert.equal((await stat(join(config, "credentials.json"))).mode & 0o777, 0o600, "token file readable only by the person");

    assert.equal(await login(), 0, "second login just reports the account");
    assert.ok(lines.some((l) => l.includes("já está conectado")));

    // a recording folder like the collector writes
    const dir = join(projectRoot, ".mapa", "recordings", "2026-10-06_10-00-00");
    await mkdir(dir, { recursive: true });
    const appmap = { version: "1.14", metadata: { name: "teste", app: "demo", mapa: { started_at: "2026-10-06T13:00:00.000Z", stopped_at: "2026-10-06T13:00:10.000Z", stopped_by: "user" } }, classMap: [], events: [] };
    await writeFile(join(dir, "recording.appmap.json.gz"), gzipSync(JSON.stringify(appmap)));
    await writeFile(join(dir, "interactions.json"), "[]");
    assert.equal(uploadConsented(projectRoot), false, "no consent yet: Stop would not send");

    const result = await uploadRecording({ root: projectRoot, packageJson: { name: "demo" } }, dir, creds);
    assert.equal(result.status, "enviada", result.message);
    assert.equal(result.url, `${site.base}/gravacoes/rec-1`);
    assert.equal(site.state.created[0].project.name, "demo");
    assert.equal(site.state.created[0].recording.stopped_by, "user");
    assert.deepEqual(Object.keys(site.state.uploads).sort(), ["interactions.json", "recording.appmap.json.gz"]);
    assert.equal(site.state.uploads["recording.appmap.json.gz"].type, "application/gzip");
    assert.deepEqual(site.state.completed, ["rec-1"]);
    assert.equal(JSON.parse(await readFile(join(dir, "upload.json"), "utf8")).status, "enviada");

    assert.equal(await logout(), 0);
    assert.equal(readCredentials(), undefined);
    assert.equal(site.state.revoked.size, 1, "token revoked on the site");
    const failed = await uploadRecording({ root: projectRoot, packageJson: { name: "demo" } }, dir, creds);
    assert.equal(failed.status, "erro", "revoked token cannot upload");
  } finally {
    console.log = log;
    delete process.env.MAPA_CONFIG_DIR;
    delete process.env.MAPA_SITE_URL;
    await site.close();
    await rm(config, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
