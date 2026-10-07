// Types for the AppMap data format (referencias/appmap/README.md, v1.14) used as Mapa's raw file.
// Mapa-specific extensions are documented in docs/format.md.

export const APPMAP_VERSION = "1.14";

/**
 * Status written when an HTTP call has no real status (network error, aborted, or still waiting at
 * Stop). The AppMap schema requires 100–599; 599 is the informal "network error" code. The return
 * also carries `error` and/or `incomplete` saying what really happened (docs/format.md).
 */
export const NO_STATUS = 599;

/**
 * `path` of synthetic calls that have no source file (user actions, errors, console, Realtime
 * frames). The AppMap validator requires every call to be in the classMap with the same path.
 */
export const SYNTHETIC_PATHS = { browser: "mapa:browser", console: "mapa:console", realtime: "mapa:realtime", recorder: "mapa:recorder" } as const;

export type RecorderType = "code" | "process" | "requests" | "remote" | "tests";

export interface Metadata {
  name?: string;
  labels?: string[];
  app?: string;
  language?: { name: string; engine?: string; version: string };
  frameworks?: { name: string; version: string }[];
  client: { name: string; url: string; version?: string };
  recorder: { type: RecorderType; name: string };
  git?: {
    repository: string;
    branch: string;
    commit: string;
    status: string[];
  };
  exception?: { class: string; message?: string };
  trimmed?: { version: string; max_length: number };
  sanitized?: { version: string; allow_values: string[] };
  /** Mapa extension: why and when the recording ended. */
  mapa?: MapaRecordingInfo;
}

export interface MapaRecordingInfo {
  started_at: string;
  stopped_at?: string;
  stopped_by?: StopReason;
  limits?: RecordingLimits;
  /** Calls that had not returned at Stop (they get a synthetic return with `incomplete: true`). */
  incomplete_calls?: number;
}

export type StopReason = "user" | "time-limit" | "event-limit" | "size-limit" | "shutdown";

export interface RecordingLimits {
  maxSeconds: number;
  maxEvents: number;
  maxMegabytes: number;
  maxCallsPerFunctionPerAction: number;
}

export interface Parameter {
  name?: string;
  class: string;
  value: string;
  object_id?: number;
  size?: number;
  properties?: ParameterSchema[];
  items?: ParameterSchema[];
}

export interface ParameterSchema {
  name?: string;
  class: string;
  properties?: ParameterSchema[];
  items?: ParameterSchema[];
}

export interface Exception {
  class: string;
  message: string;
  object_id?: number;
  path?: string;
  lineno?: number;
}

interface BaseEvent {
  id: number;
  thread_id: number;
  timestamp?: number;
}

export interface CallEvent extends BaseEvent {
  event: "call";
  defined_class?: string;
  method_id?: string;
  path?: string;
  lineno?: number;
  static?: boolean;
  receiver?: Parameter;
  parameters?: Parameter[];
  labels?: string[];
  message?: Parameter[];
  http_server_request?: {
    request_method: string;
    path_info: string;
    normalized_path_info?: string;
    protocol?: string;
    headers?: Record<string, string>;
  };
  http_client_request?: {
    request_method: string;
    url: string;
    headers?: Record<string, string>;
  };
  sql_query?: { database_type: string; sql: string };
  /** Mapa extensions (docs/format.md). */
  layer?: "browser" | "next-server" | "supabase";
  /** Transport only (recorder → collector): the AppMap schema forbids it in the final file. */
  parent_id?: number;
  /** `inferred` when the link to the parent was inferred instead of observed. */
  attribution?: "inferred";
  /** Transport only: the call in another source that caused this one (from `traceparent`). */
  remote_parent?: { source: string; id: number };
  /** Final file: id of the call, in another thread, that caused this one (e.g. the browser fetch behind a server request). */
  remote_parent_id?: number;
  /** Translation of a request to Supabase (docs/format.md). */
  supabase?: SupabaseRequestInfo;
  /** Enriched copy only: a step the database runs by itself (trigger, cascade), from the schema. */
  database?: DatabaseStep;
  /** Enriched copy only: id of the same event in the raw file. */
  raw_id?: number;
  /** A Supabase Realtime frame (WebSocket). */
  realtime?: RealtimeFrameInfo;
}

export type Certainty = "recorded" | "logs" | "schema";

export interface SupabaseFilter {
  column: string;
  op: string;
  value: string;
}

export interface SupabaseRequestInfo {
  service: "rest" | "auth" | "storage" | "functions" | "realtime" | "graphql" | "other";
  /** select, insert, update, upsert, delete, count, rpc, signup, login, refresh, logout, get_user, ... */
  operation: string;
  table?: string;
  function?: string;
  bucket?: string;
  object?: string;
  columns?: string;
  filters?: SupabaseFilter[];
  order?: string;
  limit?: number;
  offset?: number;
  on_conflict?: string;
  single?: boolean;
  /** Number of rows sent in an insert/upsert body. */
  rows?: number;
  /** Columns written by an insert/update/upsert (names only; values are in `message`). */
  write_columns?: string[];
  /** Readable SQL equivalent, derived (never seen in the database). */
  sql?: string;
  /** Enriched copy: what the database structure says about this request (Etapa 7). */
  findings?: SupabaseFinding[];
  /** Enriched copy: what Supabase's own logs say about this request (second phase, Etapa 7). */
  logs?: SupabaseLogInfo;
  /** Who made the request, read only from the token's `role` and `sub`. */
  role?: string;
  user_id?: string;
  key?: "jwt" | "publishable" | "secret";
  certainty: Certainty;
}

export type SupabaseFindingKind =
  | "policy"
  | "rls_filtered"
  | "rls_denied"
  | "rls_no_policy"
  | "rls_off"
  | "rls_bypassed"
  | "trigger"
  | "cascade"
  | "function"
  | "bucket"
  | "bucket_denied"
  | "edge_function"
  | "edge_function_missing";

export interface PolicyRef {
  name: string;
  command: string;
  roles: string[];
  using: string | null;
  with_check: string | null;
}

export interface SupabaseFinding {
  kind: SupabaseFindingKind;
  certainty: Certainty;
  table?: string;
  /** Rules that apply to this request (same operation and role). */
  policies?: PolicyRef[];
  /** Rules of the same table and operation for OTHER roles (e.g. only logged-in users may read). */
  other_policies?: PolicyRef[];
  /** Role of the request when it matters for the explanation (anon = not logged in). */
  role?: string;
  trigger?: string;
  function?: string;
  security?: "definer" | "invoker";
  bucket?: string;
  public?: boolean;
  verify_jwt?: boolean;
}

export interface DatabaseStep {
  kind: "trigger" | "cascade";
  name: string;
  /** schema.table where it happens */
  table: string;
  function?: string;
  timing?: string;
  certainty: Certainty;
}

export interface SupabaseLogInfo {
  certainty: "logs";
  source: string;
  timestamp: string;
  status?: number;
  request_id?: string;
  /** "exact" (same request id) or "nearest" (same method, path and status, closest in time) */
  match: "exact" | "nearest";
  execution_id?: string;
  /** console.log lines of an Edge Function, masked */
  console?: { timestamp: string; level?: string; message: string }[];
  /** database errors around this request */
  database_errors?: { timestamp: string; severity?: string; message: string }[];
}

export interface RealtimeFrameInfo {
  direction: "send" | "receive";
  topic?: string;
  event?: string;
  /** For phx_join: the postgres_changes subscriptions. For postgres_changes: the change. */
  changes?: { event?: string; schema?: string; table?: string; filter?: string }[];
  status?: string;
}

export interface ReturnEvent extends BaseEvent {
  event: "return";
  parent_id: number;
  elapsed?: number;
  return_value?: Parameter;
  exceptions?: Exception[];
  http_server_response?: { status_code: number; headers?: Record<string, string>; return_value?: Parameter };
  http_client_response?: { status_code: number; headers?: Record<string, string>; return_value?: Parameter };
  /** Mapa extension: the call had not returned when the recording stopped (synthetic return). */
  incomplete?: boolean;
  /** Mapa extension: an HTTP call that failed without a response (network error, aborted). */
  error?: { class: string; message: string };
  /** Enriched copy only: id of the same event in the raw file. */
  raw_id?: number;
}

export type Event = CallEvent | ReturnEvent;

export interface ClassMapFunction {
  type: "function";
  name: string;
  location?: string;
  static: boolean;
  labels?: string[];
}

export interface ClassMapClass {
  type: "class";
  name: string;
  children?: (ClassMapClass | ClassMapFunction)[];
}

export interface ClassMapPackage {
  type: "package";
  name: string;
  children?: (ClassMapPackage | ClassMapClass)[];
}

export interface AppMap {
  version: string;
  metadata: Metadata;
  classMap: ClassMapPackage[];
  events: Event[];
  eventUpdates?: Record<string, Event>;
}

/** One entry per user action in interactions.json (index of the recording, like AppMap's per-request files). */
export interface Interaction {
  event_id: number;
  kind: "click" | "submit" | "type" | "navigate";
  /** Description of the element (or of the page, for navigations). */
  target: string;
  started_at: number;
  ended_at?: number;
  event_count: number;
}
