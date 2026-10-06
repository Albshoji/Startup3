// Types for the AppMap data format (referencias/appmap/README.md, v1.14) used as Mapa's raw file.
// Mapa-specific extensions are documented in docs/format.md.

export const APPMAP_VERSION = "1.14";

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
  target: string;
  started_at: number;
  ended_at?: number;
  event_count: number;
}
