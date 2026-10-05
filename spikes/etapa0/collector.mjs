// SPIKE (Etapa 0) — minimal local collector: receives events, assembles an AppMap, measures size.
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const PORT = 47100;
let events = []; // { source, e }
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function assemble() {
  const idMap = new Map();
  let next = 1;
  const gid = (source, id) => {
    const k = `${source}:${id}`;
    if (!idMap.has(k)) idMap.set(k, next++);
    return idMap.get(k);
  };
  const sorted = [...events].sort((a, b) => (a.e.timestamp ?? 0) - (b.e.timestamp ?? 0) || 0);
  const out = events.map(({ source, e }) => {
    const copy = { ...e, id: gid(source, e.id) };
    if (e.parent_id !== undefined) copy.parent_id = gid(source, e.parent_id);
    if (e.browser_parent_id !== undefined) {
      copy.parent_id = gid(`browser-${e.browser_session}`, e.browser_parent_id);
      delete copy.browser_parent_id;
      delete copy.browser_session;
    }
    return copy;
  });
  void sorted;
  return {
    version: "1.14",
    metadata: { client: { name: "mapa-spike", url: "local" }, recorder: { type: "remote", name: "mapa" }, language: { name: "javascript" } },
    classMap: [],
    events: out,
  };
}

function analyze(appmap) {
  const byId = new Map(appmap.events.map((e) => [e.id, e]));
  const calls = appmap.events.filter((e) => e.event === "call");
  const chain = (e) => {
    const names = [];
    let cur = e;
    let guard = 0;
    while (cur && guard++ < 200) {
      names.push(cur.http_client_request ? `fetch ${cur.http_client_request.request_method} ${new URL(cur.http_client_request.url).pathname}` : cur.http_server_request ? `REQ ${cur.http_server_request.request_method} ${cur.http_server_request.path_info}` : `${cur.layer === "browser" ? "B" : "S"}:${cur.defined_class}.${cur.method_id}`);
      cur = cur.parent_id !== undefined ? byId.get(cur.parent_id) : undefined;
    }
    return names.reverse().join(" > ");
  };
  const fetches = calls.filter((e) => e.http_client_request).map((e) => ({ attribution: e.attribution, chain: chain(e) }));
  const fnCounts = {};
  for (const e of calls) if (e.method_id) fnCounts[`${e.layer}:${e.defined_class}.${e.method_id}`] = (fnCounts[`${e.layer}:${e.defined_class}.${e.method_id}`] || 0) + 1;
  const json = JSON.stringify(appmap);
  return {
    events: appmap.events.length,
    calls: calls.length,
    byLayer: calls.reduce((m, e) => ((m[e.layer || "?"] = (m[e.layer || "?"] || 0) + 1), m), {}),
    jsonBytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(json).length,
    fetches,
    topFunctions: Object.entries(fnCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
    serverRequests: calls.filter((e) => e.http_server_request).map((e) => chain(e)),
  };
}

http
  .createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return res.end();
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/events") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          if (!body) return res.end("empty");
          for (const e of JSON.parse(body)) events.push({ source: url.searchParams.get("source"), e });
        } catch {}
        res.end("ok");
      });
      return;
    }
    if (url.pathname === "/reset") {
      events = [];
      return res.end("reset");
    }
    if (url.pathname === "/dump") {
      const name = url.searchParams.get("name") || "recording";
      const appmap = assemble();
      const json = JSON.stringify(appmap);
      writeFileSync(`${OUT}${name}.appmap.json`, json);
      writeFileSync(`${OUT}${name}.appmap.json.gz`, gzipSync(json));
      const analysis = analyze(appmap);
      writeFileSync(`${OUT}${name}.analysis.json`, JSON.stringify(analysis, null, 2));
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(analysis, null, 2));
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(PORT, () => console.log(`collector on ${PORT}`));
