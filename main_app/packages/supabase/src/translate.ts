// Translation of a request to Supabase into the equivalent operation (CLAUDE.md §7.2), the way
// AppMap shows a `sql_query` for a backend that talks to its database (docs/appmap-mapping.md §6).
// Works in the browser and on the server (no Node APIs). Only structure is taken from the request;
// values that appear in the result (filters) are masked and cut.
import { clipValue, maskSummary, type SupabaseFilter, type SupabaseRequestInfo } from "@mapa/format";

export interface HeaderReader {
  get(name: string): string | null;
}

export interface SupabaseRequest {
  method: string;
  url: string | URL;
  headers?: HeaderReader;
  /** Raw request body as text, when available. */
  body?: string;
}

export interface Translation {
  info: SupabaseRequestInfo;
  labels: string[];
}

const SERVICE_PREFIXES = {
  "/rest/v1": "rest",
  "/auth/v1": "auth",
  "/storage/v1": "storage",
  "/functions/v1": "functions",
  "/realtime/v1": "realtime",
  "/graphql/v1": "graphql",
} as const;

/**
 * True for requests to hosted Supabase (`*.supabase.co`) or to the project URL the app is configured
 * with (custom domains), on one of the Supabase API paths.
 */
export function isSupabaseUrl(url: string | URL, projectUrl?: string): boolean {
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  let host = /\.supabase\.(co|in)$/.test(u.hostname);
  if (!host && projectUrl) {
    try {
      host = new URL(projectUrl).host === u.host;
    } catch {
      host = false;
    }
  }
  return host && serviceOf(u.pathname) !== undefined;
}

function serviceOf(pathname: string): { service: SupabaseRequestInfo["service"]; rest: string } | undefined {
  for (const [prefix, service] of Object.entries(SERVICE_PREFIXES)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return { service, rest: pathname.slice(prefix.length) };
  }
  return undefined;
}

export function translateSupabaseRequest(request: SupabaseRequest): Translation {
  const url = new URL(String(request.url));
  const method = request.method.toUpperCase();
  const found = serviceOf(url.pathname) ?? { service: "other" as const, rest: url.pathname };
  // WebSockets carry no headers: supabase-js puts the key in the query string.
  const identity = identityFromHeaders(request.headers) ?? identityFromToken(url.searchParams.get("apikey") ?? undefined);
  const labels: string[] = [];
  let info: SupabaseRequestInfo;

  switch (found.service) {
    case "rest":
      info = translateRest(method, found.rest, url.searchParams, request.headers, request.body);
      if (info.operation === "select" || info.operation === "count") labels.push("dao.materialize");
      break;
    case "auth":
      info = translateAuth(method, found.rest, url.searchParams);
      if (info.operation === "logout") labels.push("security.logout");
      else if (AUTHENTICATION_OPERATIONS.has(info.operation)) labels.push("security.authentication");
      break;
    case "storage":
      info = translateStorage(method, found.rest);
      break;
    case "functions": {
      const [name, ...sub] = segments(found.rest);
      info = { service: "functions", operation: "invoke", ...(name ? { function: [name, ...sub].join("/") } : {}), certainty: "recorded" };
      break;
    }
    case "realtime":
      info = { service: "realtime", operation: found.rest.startsWith("/websocket") ? "connect" : found.rest.includes("broadcast") ? "broadcast" : "other", certainty: "recorded" };
      break;
    case "graphql":
      info = { service: "graphql", operation: "query", certainty: "recorded" };
      break;
    default:
      info = { service: "other", operation: method.toLowerCase(), certainty: "recorded" };
  }

  if (identity) {
    info.role = identity.role;
    if (identity.user_id) info.user_id = identity.user_id;
    if (identity.key) info.key = identity.key;
    if (identity.role === "anon") labels.push("access.public");
  }
  return { info, labels };
}

// ---- PostgREST (/rest/v1) ----

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "apikey"]);
const OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
  match: "~",
  imatch: "~*",
  is: "is",
  isdistinct: "is distinct from",
  in: "in",
  cs: "@>",
  cd: "<@",
  ov: "&&",
  sl: "<<",
  sr: ">>",
  nxl: "&<",
  nxr: "&>",
  adj: "-|-",
  fts: "@@",
  plfts: "@@",
  phfts: "@@",
  wfts: "@@",
};

function translateRest(method: string, rest: string, params: URLSearchParams, headers: HeaderReader | undefined, body: string | undefined): SupabaseRequestInfo {
  const [first, second] = segments(rest);
  const prefer = headers?.get("prefer") ?? "";
  const accept = headers?.get("accept") ?? "";

  if (first === "rpc" && second) {
    const args = method === "GET" ? [...params.keys()].filter((k) => !RESERVED.has(k)) : bodyColumns(body).columns;
    return {
      service: "rest",
      operation: "rpc",
      function: second,
      certainty: "recorded",
      sql: `select ${second}(${args.join(", ")})`,
      ...filtersAndModifiers(params, method === "GET" ? new Set(args) : new Set()),
    };
  }

  const table = first ?? "";
  let operation: string;
  if (method === "GET") operation = "select";
  else if (method === "HEAD") operation = "count";
  else if (method === "POST") operation = /resolution=(merge|ignore)-duplicates/.test(prefer) ? "upsert" : "insert";
  else if (method === "PUT") operation = "upsert";
  else if (method === "PATCH") operation = "update";
  else if (method === "DELETE") operation = "delete";
  else operation = method.toLowerCase();

  const info: SupabaseRequestInfo = { service: "rest", operation, table, certainty: "recorded", ...filtersAndModifiers(params, new Set()) };
  if (accept.includes("vnd.pgrst.object")) info.single = true;
  if (["insert", "upsert", "update"].includes(operation)) {
    const { columns, rows } = bodyColumns(body);
    if (columns.length) info.write_columns = columns;
    if (operation !== "update" && rows !== undefined) info.rows = rows;
  }
  info.sql = restSql(info);
  return info;
}

function filtersAndModifiers(params: URLSearchParams, skip: Set<string>): Partial<SupabaseRequestInfo> {
  const out: Partial<SupabaseRequestInfo> = {};
  const filters: SupabaseFilter[] = [];
  for (const [key, raw] of params) {
    if (skip.has(key)) continue;
    switch (key) {
      case "select":
        out.columns = clipValue(raw);
        continue;
      case "order":
        out.order = clipValue(raw);
        continue;
      case "limit":
        out.limit = Number(raw);
        continue;
      case "offset":
        out.offset = Number(raw);
        continue;
      case "on_conflict":
        out.on_conflict = clipValue(raw);
        continue;
      case "columns":
      case "apikey":
        continue;
    }
    if (key === "or" || key === "and" || key.endsWith(".or") || key.endsWith(".and")) {
      filters.push({ column: key, op: key.split(".").pop()!, value: clipValue(maskSummary(undefined, raw)) });
      continue;
    }
    const match = /^(not\.)?([a-z]+)(?:\((\w+)\))?\.([\s\S]*)$/.exec(raw);
    if (match && OPERATORS[match[2]!]) {
      filters.push({ column: key, op: `${match[1] ?? ""}${match[2]}`, value: clipValue(maskSummary(key, match[4] ?? "")) });
    } else filters.push({ column: key, op: "?", value: clipValue(maskSummary(key, raw)) });
  }
  if (filters.length) out.filters = filters;
  return out;
}

function restSql(info: SupabaseRequestInfo): string {
  const table = info.table ?? "?";
  const where = info.filters?.length ? ` where ${info.filters.map(filterSql).join(" and ")}` : "";
  switch (info.operation) {
    case "select": {
      const order = info.order ? ` order by ${info.order.split(",").map(orderSql).join(", ")}` : "";
      const limit = info.limit !== undefined ? ` limit ${info.limit}` : "";
      const offset = info.offset !== undefined ? ` offset ${info.offset}` : "";
      return `select ${info.columns ?? "*"} from ${table}${where}${order}${limit}${offset}`;
    }
    case "count":
      return `select count(*) from ${table}${where}`;
    case "insert":
    case "upsert": {
      const cols = info.write_columns?.length ? ` (${info.write_columns.join(", ")})` : "";
      const rows = info.rows && info.rows > 1 ? ` (${info.rows} linhas)` : "";
      const conflict = info.operation === "upsert" ? ` on conflict${info.on_conflict ? ` (${info.on_conflict})` : ""} do update` : "";
      return `insert into ${table}${cols} values …${rows}${conflict}`;
    }
    case "update":
      return `update ${table} set ${(info.write_columns ?? ["…"]).map((c) => `${c} = …`).join(", ")}${where}`;
    case "delete":
      return `delete from ${table}${where}`;
    default:
      return `${info.operation} ${table}${where}`;
  }
}

function filterSql(filter: SupabaseFilter): string {
  if (filter.op === "or" || filter.op === "and") return `(${filter.value.replace(/^\(|\)$/g, "").split(",").join(` ${filter.op} `)})`;
  const negated = filter.op.startsWith("not.");
  const op = OPERATORS[negated ? filter.op.slice(4) : filter.op] ?? filter.op;
  const value = op === "in" ? filter.value : op === "is" ? filter.value : sqlLiteral(filter.value);
  const sql = `${filter.column} ${op} ${value}`;
  return negated ? `not (${sql})` : sql;
}

function orderSql(part: string): string {
  const [column, ...mods] = part.split(".");
  return [column, ...mods.map((m) => ({ asc: "asc", desc: "desc", nullsfirst: "nulls first", nullslast: "nulls last" })[m] ?? m)].join(" ");
}

function sqlLiteral(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) || value === "true" || value === "false" || value === "null" ? value : `'${value}'`;
}

function bodyColumns(body: string | undefined): { columns: string[]; rows?: number } {
  if (!body) return { columns: [] };
  try {
    const parsed: unknown = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const columns = new Set<string>();
    for (const row of rows) if (row && typeof row === "object") for (const key of Object.keys(row)) columns.add(key);
    return { columns: [...columns], rows: rows.length };
  } catch {
    return { columns: [] };
  }
}

// ---- Auth (/auth/v1) ----

const AUTHENTICATION_OPERATIONS = new Set(["signup", "login", "refresh", "get_user", "update_user", "otp", "verify", "magiclink", "oauth_authorize", "oauth_callback", "mfa", "reauthenticate"]);

function translateAuth(method: string, rest: string, params: URLSearchParams): SupabaseRequestInfo {
  const [first, second] = segments(rest);
  let operation: string;
  switch (first) {
    case "signup":
      operation = "signup";
      break;
    case "token": {
      const grant = params.get("grant_type");
      operation = grant === "refresh_token" ? "refresh" : "login";
      return { service: "auth", operation, certainty: "recorded", ...(grant ? { function: `grant_type=${grant}` } : {}) };
    }
    case "logout":
      operation = "logout";
      break;
    case "user":
      operation = method === "GET" ? "get_user" : "update_user";
      break;
    case "otp":
    case "verify":
    case "magiclink":
    case "recover":
    case "settings":
    case "reauthenticate":
      operation = first;
      break;
    case "authorize":
      operation = "oauth_authorize";
      break;
    case "callback":
      operation = "oauth_callback";
      break;
    case "factors":
      operation = "mfa";
      break;
    case "admin":
      operation = `admin_${second ?? "other"}`;
      break;
    default:
      operation = first ?? "other";
  }
  return { service: "auth", operation, certainty: "recorded" };
}

// ---- Storage (/storage/v1) ----

function translateStorage(method: string, rest: string): SupabaseRequestInfo {
  const parts = segments(rest);
  const base = { service: "storage" as const, certainty: "recorded" as const };
  if (parts[0] === "bucket") {
    const bucket = parts[1];
    const operation =
      parts[2] === "empty" ? "empty_bucket" : method === "GET" ? (bucket ? "get_bucket" : "list_buckets") : method === "POST" ? "create_bucket" : method === "PUT" ? "update_bucket" : "delete_bucket";
    return { ...base, operation, ...(bucket ? { bucket } : {}) };
  }
  if (parts[0] !== "object") return { ...base, operation: parts[0] ?? "other" };
  const kind = parts[1];
  const withPath = (operation: string, from: number): SupabaseRequestInfo => {
    const bucket = parts[from];
    const object = parts.slice(from + 1).join("/");
    return { ...base, operation, ...(bucket ? { bucket } : {}), ...(object ? { object: clipValue(decodeURIComponent(object)) } : {}) };
  };
  switch (kind) {
    case "list":
      return withPath("list", 2);
    case "sign":
      return withPath(method === "GET" ? "download" : "sign_url", 2);
    case "public":
    case "authenticated":
      return withPath("download", 2);
    case "info":
      return withPath("info", 2);
    case "move":
    case "copy":
      return { ...base, operation: kind };
    case "upload":
      return withPath(parts[2] === "sign" ? "signed_upload" : "upload", 3);
  }
  if (parts.length === 2 && method === "DELETE") return withPath("remove", 1);
  const operation = method === "POST" ? "upload" : method === "PUT" ? "update" : method === "DELETE" ? "remove" : method === "HEAD" ? "exists" : "download";
  return withPath(operation, 1);
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

// ---- who made the request ----

export interface Identity {
  role: string;
  user_id?: string;
  key?: "jwt" | "publishable" | "secret";
}

/**
 * Reads ONLY `role` and `sub` from the bearer token (or the apikey) of a Supabase request.
 * The token itself is never kept.
 */
export function identityFromHeaders(headers: HeaderReader | undefined): Identity | undefined {
  if (!headers) return undefined;
  const auth = headers.get("authorization");
  const bearer = auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : undefined;
  return identityFromToken(bearer) ?? identityFromToken(headers.get("apikey") ?? undefined);
}

export function identityFromToken(token: string | undefined): Identity | undefined {
  if (!token) return undefined;
  if (token.startsWith("sb_publishable_")) return { role: "anon", key: "publishable" };
  if (token.startsWith("sb_secret_")) return { role: "service_role", key: "secret" };
  const payload = token.split(".")[1];
  if (!payload) return { role: "unknown" };
  try {
    const json = JSON.parse(decodeBase64Url(payload)) as { role?: unknown; sub?: unknown };
    const identity: Identity = { role: typeof json.role === "string" ? json.role : "unknown", key: "jwt" };
    if (typeof json.sub === "string") identity.user_id = json.sub;
    return identity;
  } catch {
    return { role: "unknown" };
  }
}

function decodeBase64Url(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
