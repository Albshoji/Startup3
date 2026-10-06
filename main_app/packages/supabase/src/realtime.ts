// Supabase Realtime frames (Phoenix protocol over WebSocket): only the structure is kept
// (topic, event, subscribed tables, change type); payload values are never copied.
import type { RealtimeFrameInfo } from "@mapa/format";

type Json = Record<string, unknown>;

export function parseRealtimeFrame(data: unknown, direction: RealtimeFrameInfo["direction"]): RealtimeFrameInfo | undefined {
  if (typeof data !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  let topic: unknown, event: unknown, payload: unknown;
  if (Array.isArray(parsed)) [, , topic, event, payload] = parsed; // v2: [join_ref, ref, topic, event, payload]
  else if (parsed && typeof parsed === "object") ({ topic, event, payload } = parsed as Json);
  else return undefined;

  const info: RealtimeFrameInfo = { direction };
  if (typeof topic === "string") info.topic = topic;
  if (typeof event === "string") info.event = event;
  const body = (payload && typeof payload === "object" ? payload : {}) as Json;

  if (event === "phx_join") {
    const changes = ((body.config as Json | undefined)?.postgres_changes ?? []) as Json[];
    if (Array.isArray(changes) && changes.length) info.changes = changes.map(change);
  } else if (event === "postgres_changes") {
    const data = (body.data ?? {}) as Json;
    info.changes = [change({ event: data.type ?? data.eventType, schema: data.schema, table: data.table })];
  } else if (event === "phx_reply" || event === "system") {
    if (typeof body.status === "string") info.status = body.status;
    const response = body.response as Json | undefined;
    const subscribed = response?.postgres_changes;
    if (Array.isArray(subscribed) && subscribed.length) info.changes = (subscribed as Json[]).map(change);
  }
  return info;
}

function change(source: Json): NonNullable<RealtimeFrameInfo["changes"]>[number] {
  const out: NonNullable<RealtimeFrameInfo["changes"]>[number] = {};
  for (const key of ["event", "schema", "table", "filter"] as const) {
    const value = source[key];
    if (typeof value === "string") out[key] = value.slice(0, 100);
  }
  return out;
}
