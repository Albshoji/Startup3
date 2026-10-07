// Crosses a recording with the structure of the person's database (CLAUDE.md §7.3, Etapa 7):
// for each request to Supabase, which access rules (RLS) apply, why an answer came back empty or was
// refused, and which steps the database runs by itself (triggers, cascades). Everything found here
// has the certainty "schema" ("configurado no banco": what SHOULD happen).
//
// The raw file never changes: the result is a derived copy (docs/appmap-mapping.md §11), where the
// database steps are synthetic calls inside the request that caused them, and every event keeps the
// id it has in the raw file (`raw_id`).
import { buildClassMap, type AppMap, type CallEvent, type DatabaseStep, type Event, type PolicyRef, type ReturnEvent, type SupabaseFinding } from "@mapa/format";
import { pgArray, type SchemaSnapshot } from "./schema.js";

export const DATABASE_PATH = "mapa:supabase";

const COMMANDS: Record<string, string[]> = {
  select: ["SELECT"],
  count: ["SELECT"],
  insert: ["INSERT"],
  upsert: ["INSERT", "UPDATE"],
  update: ["UPDATE"],
  delete: ["DELETE"],
};

const STORAGE_COMMANDS: Record<string, string[]> = {
  upload: ["INSERT"],
  signed_upload: ["INSERT"],
  update: ["UPDATE"],
  remove: ["DELETE"],
  move: ["UPDATE"],
  copy: ["INSERT"],
  download: ["SELECT"],
  list: ["SELECT"],
  sign_url: ["SELECT"],
  info: ["SELECT"],
  exists: ["SELECT"],
};

/** Events of a trigger definition: "AFTER INSERT OR UPDATE ON public.items" → AFTER, [INSERT, UPDATE], public.items */
export function parseTriggerDefinition(definition: string): { timing: string; events: string[]; table: string } | undefined {
  const m = /\b(BEFORE|AFTER|INSTEAD OF)\s+(.+?)\s+ON\s+(\S+)/i.exec(definition);
  if (!m) return undefined;
  const events = m[2]!.split(/\s+OR\s+/i).map((e) => e.trim().split(/\s+/)[0]!.toUpperCase());
  return { timing: m[1]!.toUpperCase(), events, table: m[3]!.replace(/"/g, "") };
}

function policyRef(p: SchemaSnapshot["policies"][number]): PolicyRef {
  return { name: p.name, command: p.command, roles: pgArray(p.roles), using: p.using, with_check: p.with_check };
}

function appliesTo(p: SchemaSnapshot["policies"][number], commands: string[], role: string | undefined): boolean {
  const roles = pgArray(p.roles);
  const roleOk = roles.includes("public") || role === undefined || roles.includes(role);
  return roleOk && (p.command === "ALL" || commands.includes(p.command));
}

function responseOf(ret: ReturnEvent | undefined) {
  const res = ret?.http_client_response;
  return { status: res?.status_code ?? 0, body: res?.return_value?.value ?? "" };
}

const ok = (status: number) => status >= 200 && status < 300;
const deniedByRls = (status: number, body: string) => (status === 401 || status === 403 || status === 400) && /row-level security|42501|"statusCode":"403"/i.test(body);

interface Analysis {
  findings: SupabaseFinding[];
  steps: DatabaseStep[];
}

/** What the structure says about one request to Supabase. */
export function analyzeRequest(call: CallEvent, ret: ReturnEvent | undefined, schema: SchemaSnapshot): Analysis {
  const info = call.supabase!;
  const { status, body } = responseOf(ret);
  const findings: SupabaseFinding[] = [];
  const steps: DatabaseStep[] = [];
  const role = info.role;
  const triggersOn = (qualifiedTable: string, events: string[]) => {
    for (const t of schema.triggers) {
      const parsed = parseTriggerDefinition(t.definition);
      const table = parsed?.table.includes(".") ? parsed.table : `${t.schema}.${parsed?.table ?? t.table}`;
      if (!parsed || table !== qualifiedTable || !parsed.events.some((e) => events.includes(e))) continue;
      steps.push({ kind: "trigger", name: t.name, table: qualifiedTable, function: t.function, timing: `${parsed.timing} ${parsed.events.join(" OR ")}`, certainty: "schema" });
      findings.push({ kind: "trigger", certainty: "schema", table: qualifiedTable, trigger: t.name, function: t.function });
    }
  };

  if (info.service === "rest" && info.table && COMMANDS[info.operation]) {
    const commands = COMMANDS[info.operation]!;
    const table = schema.tables.find((t) => t.schema === "public" && t.name === info.table);
    const tablePolicies = schema.policies.filter((p) => p.schema === "public" && p.table === info.table && appliesTo(p, commands, undefined));
    const policies = tablePolicies.filter((p) => appliesTo(p, commands, role)).map(policyRef);
    const other = tablePolicies.filter((p) => !appliesTo(p, commands, role)).map(policyRef);
    const qualified = `public.${info.table}`;
    const base = { certainty: "schema" as const, table: qualified, policies, ...(other.length ? { other_policies: other } : {}), ...(role ? { role } : {}) };
    if (table && !table.rls_enabled) findings.push({ kind: "rls_off", certainty: "schema", table: qualified });
    else if (table && role === "service_role") findings.push({ kind: "rls_bypassed", certainty: "schema", table: qualified });
    else if (table) {
      if (deniedByRls(status, body)) findings.push({ kind: "rls_denied", ...base });
      // Empty answer with RLS on: the rows exist or not, the rules decide what this role sees.
      else if (commands.includes("SELECT") && ok(status) && /^\[\s*\]/.test(body)) findings.push({ kind: "rls_filtered", ...base });
      else if (!policies.length) findings.push({ kind: "rls_no_policy", ...base });
      else findings.push({ kind: "policy", ...base });
    }
    if (ok(status) && info.operation !== "select" && info.operation !== "count") {
      triggersOn(qualified, commands);
      if (info.operation === "delete") {
        for (const fk of schema.foreign_keys.filter((k) => k.references_schema === "public" && k.references_table === info.table && k.on_delete === "cascade")) {
          steps.push({ kind: "cascade", name: fk.name, table: `${fk.schema}.${fk.table}`, certainty: "schema" });
          findings.push({ kind: "cascade", certainty: "schema", table: `${fk.schema}.${fk.table}` });
        }
      }
    }
  } else if (info.service === "rest" && info.operation === "rpc" && info.function) {
    const fn = schema.functions.find((f) => f.name === info.function);
    if (fn) findings.push({ kind: "function", certainty: "schema", function: `${fn.schema}.${fn.name}`, security: fn.security });
  } else if (info.service === "auth" && info.operation === "signup" && ok(status)) {
    triggersOn("auth.users", ["INSERT"]);
  } else if (info.service === "storage" && info.bucket) {
    const bucket = schema.buckets.find((b) => b.id === info.bucket || b.name === info.bucket);
    if (bucket) findings.push({ kind: "bucket", certainty: "schema", bucket: bucket.name, public: bucket.public });
    const commands = STORAGE_COMMANDS[info.operation] ?? [];
    const mentionsBucket = (p: SchemaSnapshot["policies"][number]) => `${p.using ?? ""} ${p.with_check ?? ""}`.includes(`'${info.bucket}'`);
    const policies = schema.policies.filter((p) => p.schema === "storage" && p.table === "objects" && appliesTo(p, commands, role) && mentionsBucket(p)).map(policyRef);
    if (deniedByRls(status, body)) findings.push({ kind: "bucket_denied", certainty: "schema", bucket: info.bucket, policies });
    else if (policies.length) findings.push({ kind: "policy", certainty: "schema", table: "storage.objects", bucket: info.bucket, policies });
  } else if (info.service === "functions" && info.function) {
    const fn = schema.edge_functions.find((f) => f.slug === info.function || f.name === info.function);
    findings.push(fn ? { kind: "edge_function", certainty: "schema", function: fn.slug, ...(fn.verify_jwt !== undefined ? { verify_jwt: fn.verify_jwt } : {}) } : { kind: "edge_function_missing", certainty: "schema", function: info.function });
  }
  return { findings, steps };
}

/** Derived copy of a recording, enriched with the database structure. */
export function enrichWithSchema(appmap: AppMap, schema: SchemaSnapshot): { appmap: AppMap; findings: number; steps: number } {
  const returns = new Map<number, ReturnEvent>();
  for (const e of appmap.events) if (e.event === "return") returns.set(e.parent_id, e);

  const analyses = new Map<number, Analysis>();
  for (const e of appmap.events) {
    if (e.event === "call" && e.supabase && e.http_client_request) {
      const analysis = analyzeRequest(e, returns.get(e.id), schema);
      if (analysis.findings.length || analysis.steps.length) analyses.set(e.id, analysis);
    }
  }

  const newId = new Map<number, number>();
  const out: Event[] = [];
  let next = 1;
  let findings = 0;
  let steps = 0;
  for (const e of appmap.events) {
    if (e.event === "call") {
      const id = next++;
      newId.set(e.id, id);
      const copy: CallEvent = { ...e, id, raw_id: e.id };
      const analysis = analyses.get(e.id);
      if (analysis?.findings.length && copy.supabase) {
        copy.supabase = { ...copy.supabase, findings: analysis.findings };
        findings += analysis.findings.length;
        if (analysis.findings.some((f) => f.policies?.length || f.kind.startsWith("rls_") || f.kind === "bucket_denied")) {
          copy.labels = [...new Set([...(copy.labels ?? []), "security.authorization"])];
        }
      }
      out.push(copy);
    } else {
      // Database steps run inside the request that caused them, right before it returns.
      for (const step of analyses.get(e.parent_id)?.steps ?? []) {
        const stepId = next++;
        out.push({
          id: stepId,
          event: "call",
          thread_id: e.thread_id,
          ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
          layer: "supabase",
          defined_class: "Database",
          method_id: step.kind === "trigger" ? `trigger ${step.name}` : `cascade ${step.name}`,
          path: DATABASE_PATH,
          static: true,
          labels: [step.kind === "trigger" ? "mapa.trigger" : "mapa.cascade"],
          parameters: [
            { name: "table", class: "String", value: step.table },
            ...(step.function ? [{ name: "function", class: "String", value: step.function }] : []),
            ...(step.timing ? [{ name: "timing", class: "String", value: step.timing }] : []),
          ],
          database: step,
        });
        out.push({ id: next++, event: "return", thread_id: e.thread_id, parent_id: stepId });
        steps++;
      }
      out.push({ ...e, id: next++, parent_id: newId.get(e.parent_id) ?? e.parent_id, raw_id: e.id });
    }
  }
  for (const e of out) {
    if (e.event === "call" && e.remote_parent_id !== undefined) e.remote_parent_id = newId.get(e.remote_parent_id) ?? e.remote_parent_id;
  }
  return { appmap: { ...appmap, classMap: buildClassMap(out), events: out }, findings, steps };
}
