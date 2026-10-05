// SPIKE (Etapa 0) — fake Supabase (PostgREST + Auth) on localhost, so supabase-js
// can be exercised without credentials. Not a real Supabase.
import http from "node:http";

const items = [{ id: 1, nome: "Café", preco: 12.5, owner_id: "u1" }];
let nextId = 2;

http
  .createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-expose-headers", "*");
    if (req.method === "OPTIONS") return res.end();
    if (req.headers.traceparent) console.log("traceparent seen", req.method, req.url);
    else console.log("no traceparent", req.method, req.url.split("?")[0]);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      res.setHeader("content-type", "application/json");
      setTimeout(() => {
        if (url.pathname === "/rest/v1/items" && req.method === "GET") return res.end(JSON.stringify(items));
        if (url.pathname === "/rest/v1/items" && req.method === "POST") {
          const row = { id: nextId++, ...JSON.parse(body || "{}") };
          items.push(row);
          res.statusCode = 201;
          return res.end(JSON.stringify([row]));
        }
        if (url.pathname === "/rest/v1/items" && req.method === "PATCH") return res.end(JSON.stringify([]));
        if (url.pathname === "/rest/v1/rpc/calcular_total") return res.end(JSON.stringify(items.reduce((s, i) => s + (i.preco || 0), 0)));
        if (url.pathname.startsWith("/auth/v1/user")) { res.statusCode = 401; return res.end(JSON.stringify({ message: "no session" })); }
        res.statusCode = 404;
        res.end(JSON.stringify({ message: "not found" }));
      }, 20);
    });
  })
  .listen(54399, () => console.log("mock supabase on 54399"));
