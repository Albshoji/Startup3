// Supabase's own logs, second phase of processing (CLAUDE.md §7.6, Etapa 7): they show up minutes
// after the requests, so they are fetched later and written as AppMap `eventUpdates` on the enriched
// copy (referencias/appmap/README.md: an update replaces the event with the same id). Certainty "logs".
//
// Endpoint and matching validated in Etapa 0 (docs/spike-report.md, risk 6; spikes/etapa0/supabase/
// match-logs.py): one `logs` table in ClickHouse SQL, source in the `source` column, fields in
// `log_attributes['…']`; server requests match exactly by `sb-request-id`, browser requests by
// method + path + status + closest time (CORS hides the id from the browser); Edge Function
// `console.log` lines by `execution_id`. The API refuses queries too close together: retry with waits.
import { maskText, type AppMap, type CallEvent, type Event, type ReturnEvent, type SupabaseLogInfo } from "@mapa/format";
import { ManagementApiError, type ManagementClient } from "./management.js";

export interface LogRow {
  timestamp: string;
  source: string;
  event_message: string;
  method?: string | null;
  path?: string | null;
  status?: string | number | null;
  request_id?: string | null;
  execution_id?: string | null;
  level?: string | null;
  severity?: string | null;
}

export const LOG_QUERIES = {
  requests: `select timestamp, source, event_message,
      log_attributes['request.method'] as method,
      coalesce(nullIf(log_attributes['request.path'], ''), path(log_attributes['request.url'])) as path,
      log_attributes['response.status_code'] as status,
      log_attributes['request_id'] as request_id,
      log_attributes['execution_id'] as execution_id
    from logs where source in ('edge_logs', 'function_edge_logs') order by timestamp limit 1000`,
  console: `select timestamp, source, event_message, log_attributes['execution_id'] as execution_id, log_attributes['level'] as level
    from logs where source = 'function_logs' order by timestamp limit 1000`,
  database: `select timestamp, source, event_message, log_attributes['parsed.error_severity'] as severity
    from logs where source = 'postgres_logs' and log_attributes['parsed.error_severity'] in ('ERROR', 'FATAL', 'PANIC') order by timestamp limit 200`,
} as const;

/** Log timestamps come as ISO text (no zone = UTC) or as epoch numbers (µs or ms). Returns seconds. */
export function logTime(value: string | number): number {
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    return n > 1e15 ? n / 1e6 : n > 1e12 ? n / 1e3 : n;
  }
  const text = String(value);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(" ", "T")}Z`) / 1000;
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d+Z$/, "Z");

/** Runs the log queries for a time window, waiting and retrying when the API says "too many requests". */
export async function fetchLogs(
  client: ManagementClient,
  ref: string,
  from: number,
  to: number,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<LogRow[]> {
  const rows: LogRow[] = [];
  for (const sql of Object.values(LOG_QUERIES)) {
    for (let attempt = 0; ; attempt++) {
      try {
        rows.push(...(await client.queryLogs<LogRow>(ref, sql, iso(from), iso(to))));
        break;
      } catch (error) {
        if (error instanceof ManagementApiError && error.status === 429 && attempt < 3) {
          await wait(20_000);
          continue;
        }
        throw error;
      }
    }
    await wait(1_000); // spacing between queries
  }
  return rows;
}

const MESSAGE_MAX = 300;
const masked = (text: string) => maskText(String(text ?? "")).slice(0, MESSAGE_MAX);

/**
 * Ties log rows to the recorded requests to Supabase. Returns `eventUpdates` (updated copies of the
 * request calls with `supabase.logs`) and how many requests were matched.
 */
export function matchLogs(appmap: AppMap, rows: LogRow[]): { updates: Record<string, Event>; matched: number; requests: number } {
  const returns = new Map<number, ReturnEvent>();
  for (const e of appmap.events) if (e.event === "return") returns.set(e.parent_id, e);
  const requests = appmap.events.filter(
    (e): e is CallEvent => e.event === "call" && !!e.supabase && !!e.http_client_request && e.supabase.service !== "realtime",
  );
  const apiRows = rows.filter((r) => r.source === "edge_logs" || r.source === "function_edge_logs").map((r) => ({ ...r, t: logTime(r.timestamp) }));
  const consoleRows = rows.filter((r) => r.source === "function_logs");
  const dbRows = rows.filter((r) => r.source === "postgres_logs").map((r) => ({ ...r, t: logTime(r.timestamp) }));
  const used = new Set<string>();
  const updates: Record<string, Event> = {};
  let matched = 0;

  for (const call of requests) {
    const ret = returns.get(call.id);
    const status = ret?.http_client_response?.status_code;
    const requestId = ret?.http_client_response?.headers?.["sb-request-id"];
    const executionHeader = ret?.http_client_response?.headers?.["x-deno-execution-id"];
    const path = new URL(call.http_client_request!.url).pathname;
    const t = call.timestamp ?? 0;
    let row: (typeof apiRows)[number] | undefined;
    let how: SupabaseLogInfo["match"] = "nearest";
    if (requestId) {
      row = apiRows.find((r) => r.request_id === requestId);
      how = "exact";
    }
    if (!row) {
      row = apiRows
        .filter((r) => !used.has(`${r.source}:${r.request_id}:${r.timestamp}`) && r.method === call.http_client_request!.request_method && r.path === path && String(r.status) === String(status) && Math.abs(r.t - t) < 10)
        .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
      how = "nearest";
    }
    if (!row) continue;
    used.add(`${row.source}:${row.request_id}:${row.timestamp}`);
    matched++;

    const logs: SupabaseLogInfo = { certainty: "logs", source: row.source, timestamp: new Date(row.t * 1000).toISOString(), match: how };
    if (row.status !== null && row.status !== undefined && row.status !== "") logs.status = Number(row.status);
    if (row.request_id) logs.request_id = row.request_id;
    const executionId = row.execution_id || executionHeader;
    if (executionId) {
      logs.execution_id = executionId;
      const lines = consoleRows.filter((r) => r.execution_id === executionId);
      if (lines.length) {
        logs.console = lines.map((r) => ({ timestamp: new Date(logTime(r.timestamp) * 1000).toISOString(), ...(r.level ? { level: r.level } : {}), message: masked(r.event_message) }));
      }
    }
    if (status !== undefined && status >= 400) {
      const errors = dbRows.filter((r) => Math.abs(r.t - row!.t) < 3);
      if (errors.length) logs.database_errors = errors.map((r) => ({ timestamp: new Date(r.t * 1000).toISOString(), ...(r.severity ? { severity: r.severity } : {}), message: masked(r.event_message) }));
    }
    updates[String(call.id)] = { ...call, supabase: { ...call.supabase!, logs } };
  }
  return { updates, matched, requests: requests.length };
}
