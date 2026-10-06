import { test } from "node:test";
import assert from "node:assert/strict";
import { identityFromHeaders, isSupabaseUrl, parseRealtimeFrame, translateSupabaseRequest } from "../dist/index.js";

const BASE = "https://abcd.supabase.co";
const headers = (h) => new Headers(h);
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.assinatura`;
const tr = (method, path, opts = {}) => translateSupabaseRequest({ method, url: BASE + path, headers: headers(opts.headers ?? {}), body: opts.body });

test("recognizes Supabase URLs (hosted and the configured project URL)", () => {
  assert.equal(isSupabaseUrl(`${BASE}/rest/v1/items`), true);
  assert.equal(isSupabaseUrl(`${BASE}/qualquer`), false);
  assert.equal(isSupabaseUrl("https://api.meusite.com/rest/v1/items", "https://api.meusite.com"), true);
  assert.equal(isSupabaseUrl("http://localhost:3000/rest/v1/items"), false);
});

test("PostgREST read with filters, order and limit → select + readable SQL + dao.materialize", () => {
  const { info, labels } = tr("GET", "/rest/v1/items?select=id,nome,preco&owner_id=eq.42&nome=ilike.*p%C3%A3o*&order=id.desc.nullslast&limit=10");
  assert.equal(info.service, "rest");
  assert.equal(info.operation, "select");
  assert.equal(info.table, "items");
  assert.equal(info.columns, "id,nome,preco");
  assert.deepEqual(info.filters, [
    { column: "owner_id", op: "eq", value: "42" },
    { column: "nome", op: "ilike", value: "*pão*" },
  ]);
  assert.equal(info.sql, "select id,nome,preco from items where owner_id = 42 and nome ilike '*pão*' order by id desc nulls last limit 10");
  assert.deepEqual(labels, ["dao.materialize"]);
});

test("insert, upsert, update, delete, rpc", () => {
  const insert = tr("POST", "/rest/v1/items?select=*", { body: JSON.stringify({ nome: "Pão", preco: 9.9 }) }).info;
  assert.equal(insert.operation, "insert");
  assert.deepEqual(insert.write_columns, ["nome", "preco"]);
  assert.equal(insert.rows, 1);
  assert.equal(insert.sql, "insert into items (nome, preco) values …");

  const upsert = tr("POST", "/rest/v1/items?on_conflict=id", { headers: { prefer: "resolution=merge-duplicates" }, body: "[{\"id\":1},{\"id\":2}]" }).info;
  assert.equal(upsert.operation, "upsert");
  assert.equal(upsert.rows, 2);
  assert.match(upsert.sql, /on conflict \(id\) do update/);

  const update = tr("PATCH", "/rest/v1/items?id=eq.1", { body: "{\"nome\":\"x\"}" }).info;
  assert.equal(update.sql, "update items set nome = … where id = 1");

  const del = tr("DELETE", "/rest/v1/items?id=in.(1,2)&not_null=not.is.null").info;
  assert.equal(del.sql, "delete from items where id in (1,2) and not (not_null is null)");

  const rpc = tr("POST", "/rest/v1/rpc/calcular_total", { body: "{\"desde\":\"2026-01-01\"}" }).info;
  assert.deepEqual([rpc.operation, rpc.function, rpc.sql], ["rpc", "calcular_total", "select calcular_total(desde)"]);
  assert.equal(tr("HEAD", "/rest/v1/items").info.operation, "count");
  assert.equal(tr("GET", "/rest/v1/items?id=eq.1", { headers: { accept: "application/vnd.pgrst.object+json" } }).info.single, true);
});

test("filter values are masked (e-mails, tokens)", () => {
  const { info } = tr("GET", "/rest/v1/profiles?email=eq.maria%40exemplo.com&token=eq.abc");
  assert.deepEqual(info.filters.map((f) => f.value), ["[e-mail]", "[mascarado]"]);
  assert.ok(!info.sql.includes("maria"));
});

test("auth operations and labels", () => {
  assert.deepEqual(tr("POST", "/auth/v1/signup").labels, ["security.authentication"]);
  assert.equal(tr("POST", "/auth/v1/token?grant_type=password").info.operation, "login");
  assert.equal(tr("POST", "/auth/v1/token?grant_type=refresh_token").info.operation, "refresh");
  assert.equal(tr("GET", "/auth/v1/user").info.operation, "get_user");
  const logout = tr("POST", "/auth/v1/logout?scope=global");
  assert.deepEqual([logout.info.operation, logout.labels], ["logout", ["security.logout"]]);
});

test("storage, functions, realtime", () => {
  assert.deepEqual(pick(tr("POST", "/storage/v1/object/avatars/u1/avatar.png").info), { operation: "upload", bucket: "avatars", object: "u1/avatar.png" });
  assert.deepEqual(pick(tr("GET", "/storage/v1/object/public/avatars/a%20b.png").info), { operation: "download", bucket: "avatars", object: "a b.png" });
  assert.deepEqual(pick(tr("POST", "/storage/v1/object/list/avatars").info), { operation: "list", bucket: "avatars" });
  assert.deepEqual(pick(tr("DELETE", "/storage/v1/object/avatars").info), { operation: "remove", bucket: "avatars" });
  assert.deepEqual(pick(tr("POST", "/storage/v1/object/sign/avatars/x.png").info), { operation: "sign_url", bucket: "avatars", object: "x.png" });
  assert.equal(tr("GET", "/storage/v1/bucket").info.operation, "list_buckets");
  const fn = tr("POST", "/functions/v1/send-welcome").info;
  assert.deepEqual([fn.service, fn.operation, fn.function], ["functions", "invoke", "send-welcome"]);
  assert.equal(tr("GET", "/realtime/v1/websocket?vsn=1.0.0").info.operation, "connect");
  assert.equal(tr("GET", `/realtime/v1/websocket?apikey=${jwt({ role: "anon" })}&vsn=1.0.0`).info.role, "anon");
});

test("identity: only role and user id, from the bearer token or the apikey", () => {
  const user = identityFromHeaders(headers({ authorization: `Bearer ${jwt({ role: "authenticated", sub: "uuid-1", email: "a@b.c" })}` }));
  assert.deepEqual(user, { role: "authenticated", key: "jwt", user_id: "uuid-1" });
  assert.deepEqual(identityFromHeaders(headers({ apikey: jwt({ role: "anon" }) })), { role: "anon", key: "jwt" });
  assert.deepEqual(identityFromHeaders(headers({ authorization: "Bearer sb_publishable_xyz" })), { role: "anon", key: "publishable" });
  assert.equal(identityFromHeaders(headers({})), undefined);
  const anon = tr("GET", "/rest/v1/items", { headers: { authorization: `Bearer ${jwt({ role: "anon" })}` } });
  assert.deepEqual(anon.labels, ["dao.materialize", "access.public"]);
  assert.equal(anon.info.role, "anon");
});

test("Realtime frames keep only the structure", () => {
  const join = parseRealtimeFrame(
    JSON.stringify(["1", "1", "realtime:itens-ao-vivo", "phx_join", { config: { postgres_changes: [{ event: "*", schema: "public", table: "items" }] }, access_token: "eyJsegredo" }]),
    "send",
  );
  assert.deepEqual(join, { direction: "send", topic: "realtime:itens-ao-vivo", event: "phx_join", changes: [{ event: "*", schema: "public", table: "items" }] });
  const change = parseRealtimeFrame(
    JSON.stringify({ topic: "realtime:itens-ao-vivo", event: "postgres_changes", payload: { data: { type: "INSERT", schema: "public", table: "items", record: { nome: "Pão" } } } }),
    "receive",
  );
  assert.deepEqual(change.changes, [{ event: "INSERT", schema: "public", table: "items" }]);
  assert.ok(!JSON.stringify(change).includes("Pão"));
  assert.equal(parseRealtimeFrame("não é json", "receive"), undefined);
});

function pick(info) {
  const { operation, bucket, object } = info;
  return Object.fromEntries(Object.entries({ operation, bucket, object }).filter(([, v]) => v !== undefined));
}
