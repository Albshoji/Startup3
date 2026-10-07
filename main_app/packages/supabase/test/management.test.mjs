import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedCall, ManagementClient, projectRefFromUrl, readSchema, ReadOnlyViolation, SCHEMA_QUERIES } from "../dist/index.js";

test("only GETs of the allowed list and the read-only SQL endpoint are allowed", () => {
  assert.equal(isAllowedCall("POST", "/v1/projects/abc123/database/query/read-only"), true);
  assert.equal(isAllowedCall("GET", "/v1/projects"), true);
  assert.equal(isAllowedCall("GET", "/v1/projects/abc123/functions"), true);
  assert.equal(isAllowedCall("POST", "/v1/projects/abc123/database/query"), false, "the endpoint that can write");
  assert.equal(isAllowedCall("POST", "/v1/projects/abc123/functions"), false);
  assert.equal(isAllowedCall("DELETE", "/v1/projects/abc123"), false);
  assert.equal(isAllowedCall("GET", "/v1/projects/abc123/api-keys"), false, "secrets are never read");
  assert.equal(isAllowedCall("PATCH", "/v1/projects/abc123/config/auth"), false);
});

function fakeApi(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization });
    const { status = 200, body } = handler(init.method, u.pathname, init.body ? JSON.parse(init.body) : undefined);
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}

test("a disallowed call never leaves the machine", async () => {
  const { calls, fetchImpl } = fakeApi(() => ({ body: {} }));
  const client = new ManagementClient(async () => "tok", fetchImpl);
  await assert.rejects(() => client.call("POST", "/v1/projects/abc/database/query", { query: "drop table x" }), ReadOnlyViolation);
  assert.equal(calls.length, 0);
});

test("readSchema uses only the read-only endpoint and GETs, and records parts it could not read", async () => {
  const { calls, fetchImpl } = fakeApi((method, path, body) => {
    if (path.endsWith("/functions")) return { body: [{ slug: "send-welcome", name: "send-welcome", status: "ACTIVE", version: 3, verify_jwt: true, updated_at: 1791300000000 }] };
    if (body.query === SCHEMA_QUERIES.webhooks) return { status: 403, body: { message: "sem permissão" } };
    if (body.query === SCHEMA_QUERIES.triggers) return { body: [{ name: "on_auth_user_created", schema: "auth", table: "users", function: "public.handle_new_user", definition: "CREATE TRIGGER …", function_code: "begin insert into public.profiles … end" }] };
    if (body.query === SCHEMA_QUERIES.policies) return { body: [{ schema: "public", table: "items", name: "dono le", command: "SELECT", roles: ["authenticated"], permissive: "PERMISSIVE", using: "(owner_id = auth.uid())", with_check: null }] };
    return { body: [] };
  });
  const client = new ManagementClient(async () => "tok-123", fetchImpl);
  const snapshot = await readSchema(client, "abc123", () => new Date("2026-10-06T00:00:00Z"));
  assert.ok(calls.every((c) => (c.method === "POST" && c.path === "/v1/projects/abc123/database/query/read-only") || c.method === "GET"));
  assert.ok(calls.every((c) => c.auth === "Bearer tok-123"));
  assert.equal(snapshot.triggers[0].function_code.includes("profiles"), true);
  assert.equal(snapshot.policies[0].using, "(owner_id = auth.uid())");
  assert.deepEqual(snapshot.edge_functions, [{ slug: "send-welcome", name: "send-welcome", status: "ACTIVE", version: 3, verify_jwt: true, updated_at: new Date(1791300000000).toISOString() }]);
  assert.deepEqual(snapshot.errors.map((e) => e.section), ["webhooks"]);
  assert.equal(snapshot.read_at, "2026-10-06T00:00:00.000Z");
});

test("project ref from the app's Supabase URL", () => {
  assert.equal(projectRefFromUrl("https://heofkizkwzznoukxplou.supabase.co"), "heofkizkwzznoukxplou");
  assert.equal(projectRefFromUrl("https://api.meusite.com"), undefined);
  assert.equal(projectRefFromUrl(undefined), undefined);
});
