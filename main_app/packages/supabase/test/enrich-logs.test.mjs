import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildAppMap, buildClassMap, linearize } from "@mapa/format";
import { enrichWithSchema, logTime, matchLogs, parseTriggerDefinition, translateSupabaseRequest } from "../dist/index.js";

const require = createRequire(import.meta.url);
const { validate } = require("@appland/appmap-validate");
const BASE = "https://heofkizkwzznoukxplou.supabase.co";
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

const schema = {
  version: 1,
  project_ref: "heofkizkwzznoukxplou",
  read_at: "2026-10-06T00:00:00Z",
  tables: [
    { schema: "public", name: "items", rls_enabled: true, rls_forced: false, columns: [], grants: [] },
    { schema: "public", name: "profiles", rls_enabled: true, rls_forced: false, columns: [], grants: [] },
    { schema: "public", name: "aberta", rls_enabled: false, rls_forced: false, columns: [], grants: [] },
  ],
  policies: [
    { schema: "public", table: "items", name: "itens: dono le", command: "SELECT", roles: "{authenticated}", permissive: "PERMISSIVE", using: "(owner_id = auth.uid())", with_check: null },
    { schema: "public", table: "items", name: "itens: dono cria", command: "INSERT", roles: ["authenticated"], permissive: "PERMISSIVE", using: null, with_check: "(owner_id = auth.uid())" },
    { schema: "storage", table: "objects", name: "avatars: dono envia", command: "INSERT", roles: ["authenticated"], permissive: "PERMISSIVE", using: null, with_check: "((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))" },
  ],
  foreign_keys: [{ name: "items_owner_id_fkey", schema: "public", table: "items", references_schema: "auth", references_table: "users", on_delete: "cascade", definition: "" }],
  triggers: [{ name: "on_auth_user_created", schema: "auth", table: "users", function: "public.handle_new_user", definition: "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()", function_code: "begin insert into public.profiles (id) values (new.id); return new; end;" }],
  functions: [{ schema: "public", name: "calcular_total", arguments: "", returns: "numeric", language: "sql", security: "invoker", code: "select sum(preco) from items" }],
  realtime_tables: [],
  webhooks: [],
  buckets: [{ id: "avatars", name: "avatars", public: false, file_size_limit: null, allowed_mime_types: null }],
  edge_functions: [{ slug: "send-welcome", name: "send-welcome", verify_jwt: true }],
  errors: [],
};

let id = 0;
const raw = [];
function request(method, path, status, body, { role = "anon", sub, t, requestId, layer = "browser" } = {}) {
  const url = new URL(BASE + path);
  const headers = new Headers({ authorization: `Bearer ${jwt({ role, ...(sub ? { sub } : {}) })}` });
  const { info, labels } = translateSupabaseRequest({ method, url, headers });
  const callId = ++id;
  raw.push({ id: callId, event: "call", thread_id: 1, timestamp: t, layer, http_client_request: { request_method: method, url: url.origin + url.pathname }, message: [], supabase: info, ...(labels.length ? { labels } : {}) });
  raw.push({ id: ++id, event: "return", thread_id: 1, parent_id: callId, elapsed: 0.1, http_client_response: { status_code: status, ...(requestId ? { headers: { "sb-request-id": requestId } } : {}), return_value: { class: "application/json", value: body } } });
  return callId;
}

const signup = request("POST", "/auth/v1/signup", 200, '{"access_token":"[mascarado]"}', { t: 1000 });
const listaVazia = request("GET", "/rest/v1/items?select=id,nome", 200, "[]", { t: 1010 });
const inserirNegado = request("POST", "/rest/v1/items", 401, '{"code":"42501","message":"new row violates row-level security policy for table \\"items\\""}', { t: 1020 });
const inserirOk = request("POST", "/rest/v1/items", 201, '[{"id":1}]', { role: "authenticated", sub: "u1", t: 1030 });
const rpc = request("POST", "/rest/v1/rpc/calcular_total", 200, "9.9", { role: "authenticated", sub: "u1", t: 1040, requestId: "req-server-1", layer: "next-server" });
const edge = request("POST", "/functions/v1/send-welcome", 200, '{"ok":true}', { role: "authenticated", sub: "u1", t: 1050 });
const avatar = request("POST", "/storage/v1/object/avatars/u1/a.txt", 200, '{"Key":"avatars/u1/a.txt"}', { role: "authenticated", sub: "u1", t: 1060 });
const aberta = request("GET", "/rest/v1/aberta", 200, "[{}]", { t: 1070 });

const { events } = linearize([{ source: "s", events: raw }]);
const appmap = buildAppMap({ client: { name: "mapa", url: "x" }, recorder: { type: "remote", name: "mapa" } }, events, buildClassMap(events));
const { appmap: enriched, steps } = enrichWithSchema(appmap, schema);
const byRaw = (rawId) => enriched.events.find((e) => e.event === "call" && e.raw_id === rawId);
const finding = (rawId) => byRaw(rawId).supabase.findings;

test("trigger definitions are understood", () => {
  assert.deepEqual(parseTriggerDefinition("CREATE TRIGGER t BEFORE INSERT OR UPDATE OF nome ON public.items FOR EACH ROW EXECUTE FUNCTION f()"), { timing: "BEFORE", events: ["INSERT", "UPDATE"], table: "public.items" });
});

test("scenario A: sign-up runs the trigger that creates the profile (configured in the database)", () => {
  const call = byRaw(signup);
  const i = enriched.events.indexOf(call);
  const step = enriched.events[i + 1];
  assert.equal(step.method_id, "trigger on_auth_user_created");
  assert.equal(step.layer, "supabase");
  assert.deepEqual(step.database, { kind: "trigger", name: "on_auth_user_created", table: "auth.users", function: "public.handle_new_user", timing: "AFTER INSERT", certainty: "schema" });
  assert.equal(enriched.events[i + 3].parent_id, call.id, "the request returns after the trigger");
  assert.equal(steps, 1);
});

test("scenario C: an empty list is explained by the access rule, citing the policy", () => {
  const [f] = finding(listaVazia);
  assert.equal(f.kind, "rls_filtered");
  assert.equal(f.certainty, "schema");
  assert.equal(f.table, "public.items");
  assert.equal(f.role, "anon");
  assert.deepEqual(f.policies, [], "no read rule for anon (not logged in)");
  assert.deepEqual(f.other_policies.map((p) => [p.name, p.using, p.roles]), [["itens: dono le", "(owner_id = auth.uid())", ["authenticated"]]], "cites the rule that exists");
});

test("rules: anon reading items has no policy; refused insert cites WITH CHECK; allowed insert lists the rule; rls off flagged", () => {
  assert.equal(finding(listaVazia)[0].kind, "rls_filtered");
  const denied = finding(inserirNegado)[0];
  assert.equal(denied.kind, "rls_denied");
  const okInsert = finding(inserirOk)[0];
  assert.equal(okInsert.kind, "policy");
  assert.deepEqual(okInsert.policies.map((p) => p.name), ["itens: dono cria"]);
  assert.ok(byRaw(inserirOk).labels.includes("security.authorization"));
  assert.equal(finding(aberta)[0].kind, "rls_off");
  assert.deepEqual(finding(rpc), [{ kind: "function", certainty: "schema", function: "public.calcular_total", security: "invoker" }]);
  assert.deepEqual(finding(edge), [{ kind: "edge_function", certainty: "schema", function: "send-welcome", verify_jwt: true }]);
  const bucket = finding(avatar);
  assert.deepEqual(bucket[0], { kind: "bucket", certainty: "schema", bucket: "avatars", public: false });
  assert.deepEqual(bucket[1].policies.map((p) => p.name), ["avatars: dono envia"]);
});

test("the enriched copy is a valid AppMap (with eventUpdates from the logs)", () => {
  const rows = [
    { timestamp: "2026-10-06T00:00:00", source: "edge_logs", event_message: "x", method: "GET", path: "/rest/v1/items", status: "200", request_id: "r-c" },
    { timestamp: 1040.2 * 1e6, source: "edge_logs", event_message: "x", method: "POST", path: "/rest/v1/rpc/calcular_total", status: "200", request_id: "req-server-1" },
    { timestamp: new Date(1050.4 * 1000).toISOString(), source: "function_edge_logs", event_message: "POST | 200", method: "POST", path: "/functions/v1/send-welcome", status: 200, request_id: "r-d", execution_id: "exec-9" },
    { timestamp: new Date(1050.3 * 1000).toISOString(), source: "function_logs", event_message: "Boas-vindas para Maria (maria@exemplo.com)", execution_id: "exec-9", level: "log" },
    { timestamp: new Date(1050.35 * 1000).toISOString(), source: "function_logs", event_message: "enviado", execution_id: "exec-9", level: "info" },
    { timestamp: new Date(1020.1 * 1000).toISOString(), source: "edge_logs", event_message: "x", method: "POST", path: "/rest/v1/items", status: "401", request_id: "r-neg" },
    { timestamp: new Date(1020.2 * 1000).toISOString(), source: "postgres_logs", event_message: 'new row violates row-level security policy for table "items"', severity: "ERROR" },
  ];
  const { updates, matched, requests } = matchLogs(enriched, rows);
  assert.equal(requests, 8);
  const rpcUpdate = updates[byRaw(rpc).id];
  assert.equal(rpcUpdate.supabase.logs.match, "exact");
  const edgeLogs = updates[byRaw(edge).id].supabase.logs;
  assert.equal(edgeLogs.match, "nearest");
  assert.deepEqual(edgeLogs.console.map((l) => l.message), ["Boas-vindas para Maria ([e-mail])", "enviado"], "console.log lines, masked");
  assert.equal(edgeLogs.certainty, "logs");
  const deniedLogs = updates[byRaw(inserirNegado).id].supabase.logs;
  assert.match(deniedLogs.database_errors[0].message, /row-level security/);
  assert.equal(matched, 3, "the GET without a log at the right time is not forced");
  const withUpdates = { ...enriched, eventUpdates: updates };
  assert.doesNotThrow(() => validate({ ...withUpdates, version: "1.13.1" }));
});

test("log timestamps in any of the formats the API uses", () => {
  assert.equal(logTime("1970-01-01T00:00:10"), 10);
  assert.equal(logTime(1_759_700_000_000_000), 1_759_700_000, "microseconds");
  assert.equal(logTime(1_759_700_000_000), 1_759_700_000, "milliseconds");
  assert.equal(logTime("2026-10-06T00:00:00.000Z"), Date.parse("2026-10-06T00:00:00Z") / 1000);
});
