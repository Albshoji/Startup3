// Snapshot of the structure of the person's database (CLAUDE.md §7.5): the "classMap" of the
// database side, stored with each recording (`supabase-schema.json`). Read only through the
// read-only SQL endpoint and GET endpoints (see management.ts). Queries validated in Etapa 0
// (spikes/etapa0/supabase/structure.py; `information_schema` grants come back empty there, so
// grants are read from `pg_class.relacl`).
import { ManagementApiError, type ManagementClient } from "./management.js";

export interface SchemaSnapshot {
  version: 1;
  project_ref: string;
  read_at: string;
  tables: {
    schema: string;
    name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
    columns: { name: string; type: string; nullable: boolean; default: string | null }[];
    grants: { role: string; privileges: string }[];
  }[];
  policies: { schema: string; table: string; name: string; command: string; roles: string[]; permissive: string; using: string | null; with_check: string | null }[];
  foreign_keys: { name: string; schema: string; table: string; references_schema: string; references_table: string; on_delete: string; definition: string }[];
  triggers: { name: string; schema: string; table: string; function: string; definition: string; function_code: string | null }[];
  functions: { schema: string; name: string; arguments: string; returns: string; language: string; security: "definer" | "invoker"; code: string | null }[];
  realtime_tables: { schema: string; table: string }[];
  webhooks: { name: string; table: string; definition: string }[];
  buckets: { id: string; name: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }[];
  edge_functions: { slug: string; name: string; status?: string; version?: number; verify_jwt?: boolean; updated_at?: string }[];
  /** Parts that could not be read (e.g. a permission missing, database not answering), so the site can say what is missing. */
  errors: { section: string; message: string }[];
}

export const SCHEMA_QUERIES = {
  tables: `
    select n.nspname as schema, c.relname as name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
      coalesce((select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                 'nullable', not a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
               from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]'::json) as columns,
      coalesce((select json_agg(json_build_object('role', g.role, 'privileges', g.privileges))
               from (select x.grantee::regrole::text as role, string_agg(x.privilege_type, ', ' order by x.privilege_type) as privileges
                     from aclexplode(c.relacl) x
                     where x.grantee in ('anon'::regrole, 'authenticated'::regrole) group by 1) g), '[]'::json) as grants
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'storage')
    order by 1, 2`,
  policies: `
    select schemaname as schema, tablename as "table", policyname as name, cmd as command, to_json(roles::text[]) as roles, permissive,
           qual as using, with_check
    from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3`,
  foreign_keys: `
    select con.conname as name, ns.nspname as schema, cl.relname as "table",
           fns.nspname as references_schema, fcl.relname as references_table,
           case con.confdeltype when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default'
                                when 'r' then 'restrict' else 'no action' end as on_delete,
           pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_class fcl on fcl.oid = con.confrelid join pg_namespace fns on fns.oid = fcl.relnamespace
    where con.contype = 'f' and ns.nspname = 'public' order by 3, 1`,
  triggers: `
    select t.tgname as name, n.nspname as schema, c.relname as "table",
           pn.nspname || '.' || p.proname as function, pg_get_triggerdef(t.oid) as definition, p.prosrc as function_code
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and (n.nspname = 'public' or (n.nspname = 'auth' and pn.nspname = 'public'))
    order by 2, 3, 1`,
  functions: `
    select n.nspname as schema, p.proname as name, pg_get_function_arguments(p.oid) as arguments,
           pg_get_function_result(p.oid) as returns, l.lanname as language,
           case when p.prosecdef then 'definer' else 'invoker' end as security, p.prosrc as code
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f' order by 2`,
  realtime_tables: `
    select schemaname as schema, tablename as "table" from pg_publication_tables
    where pubname = 'supabase_realtime' order by 1, 2`,
  webhooks: `
    select t.tgname as name, c.relname as "table", pg_get_triggerdef(t.oid) as definition
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and pn.nspname = 'supabase_functions' and p.proname = 'http_request'`,
  buckets: `select id, name, public, file_size_limit, to_json(allowed_mime_types) as allowed_mime_types from storage.buckets order by 1`,
} as const;

/**
 * Postgres arrays may come back as text ("{anon,authenticated}") depending on the column type;
 * always a list here.
 */
export function pgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** Reads the whole structure. Each part fails on its own (and is listed in `errors`). */
export async function readSchema(client: ManagementClient, ref: string, now: () => Date = () => new Date()): Promise<SchemaSnapshot> {
  const snapshot: SchemaSnapshot = {
    version: 1,
    project_ref: ref,
    read_at: now().toISOString(),
    tables: [],
    policies: [],
    foreign_keys: [],
    triggers: [],
    functions: [],
    realtime_tables: [],
    webhooks: [],
    buckets: [],
    edge_functions: [],
    errors: [],
  };
  const sections = Object.keys(SCHEMA_QUERIES) as (keyof typeof SCHEMA_QUERIES)[];
  for (const section of sections) {
    try {
      (snapshot[section] as unknown[]) = await client.readOnlyQuery(ref, SCHEMA_QUERIES[section]);
    } catch (error) {
      snapshot.errors.push({ section, message: error instanceof Error ? error.message : String(error) });
      // The database is not answering (paused project, timeout): the other queries would wait too.
      if (error instanceof ManagementApiError && error.status >= 500) {
        for (const rest of sections.slice(sections.indexOf(section) + 1)) snapshot.errors.push({ section: rest, message: "não lida: o banco não respondeu" });
        break;
      }
    }
  }
  snapshot.policies = snapshot.policies.map((p) => ({ ...p, roles: pgArray(p.roles) }));
  snapshot.buckets = snapshot.buckets.map((b) => ({ ...b, allowed_mime_types: b.allowed_mime_types === null ? null : pgArray(b.allowed_mime_types) }));
  try {
    snapshot.edge_functions = (await client.listFunctions(ref)).map((f) => ({
      slug: f.slug,
      name: f.name,
      ...(f.status ? { status: f.status } : {}),
      ...(f.version !== undefined ? { version: f.version } : {}),
      ...(f.verify_jwt !== undefined ? { verify_jwt: f.verify_jwt } : {}),
      ...(f.updated_at !== undefined ? { updated_at: new Date(f.updated_at).toISOString() } : {}),
    }));
  } catch (error) {
    snapshot.errors.push({ section: "edge_functions", message: error instanceof Error ? error.message : String(error) });
  }
  return snapshot;
}

/** Ref of a hosted Supabase project from its URL (https://<ref>.supabase.co). */
export function projectRefFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return /^([a-z0-9]{6,40})\.supabase\.(co|in)$/.exec(new URL(url).hostname)?.[1];
  } catch {
    return undefined;
  }
}
