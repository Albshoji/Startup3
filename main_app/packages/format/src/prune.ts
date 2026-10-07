// Automatic cut of large recordings (CLAUDE.md §9.3), with AppMap's method
// (referencias/appmap-js/packages/models/src/appMapBuilder/index.js `prune`): estimate the size of
// each function's calls (code only: never HTTP or SQL), drop the calls of the largest ones until the
// remaining size fits, and record what was dropped. Removing a call and its return keeps the order
// valid: its children simply move up one level.
import type { AppMap, CallEvent, Event } from "./types.js";

/** AppMap prunes maps above ~10 MB (refining docs). */
export const PRUNE_THRESHOLD_BYTES = 10 * 1024 * 1024;

export interface PrunedFunction {
  function: string;
  location: string;
  removed_calls: number;
  bytes: number;
}

const keyOf = (e: CallEvent) => `${e.defined_class}.${e.method_id}@${e.path ?? ""}:${e.lineno ?? ""}`;

export function pruneAppMap(appmap: AppMap, maxBytes = PRUNE_THRESHOLD_BYTES): { appmap: AppMap; pruned: PrunedFunction[] } {
  const total = JSON.stringify(appmap).length;
  if (total <= maxBytes) return { appmap, pruned: [] };

  const returns = new Map<number, Event>();
  for (const e of appmap.events) if (e.event === "return") returns.set(e.parent_id, e);
  const sizes = new Map<string, PrunedFunction>();
  for (const e of appmap.events) {
    if (e.event !== "call" || e.method_id === undefined || e.http_client_request || e.http_server_request || e.sql_query) continue;
    if (e.labels?.includes("mapa.user-action")) continue; // never drop what the person did
    const key = keyOf(e);
    const entry = sizes.get(key) ?? { function: `${e.defined_class}.${e.method_id}`, location: `${e.path ?? ""}${e.lineno !== undefined ? `:${e.lineno}` : ""}`, removed_calls: 0, bytes: 0 };
    entry.removed_calls++;
    entry.bytes += JSON.stringify(e).length + JSON.stringify(returns.get(e.id) ?? {}).length;
    sizes.set(key, entry);
  }

  const excluded = new Set<string>();
  const pruned: PrunedFunction[] = [];
  let remaining = total;
  for (const [key, entry] of [...sizes].sort((a, b) => b[1].bytes - a[1].bytes)) {
    if (remaining <= maxBytes) break;
    excluded.add(key);
    pruned.push(entry);
    remaining -= entry.bytes;
  }

  const dropped = new Set<number>();
  const events: Event[] = [];
  for (const e of appmap.events) {
    if (e.event === "call" && e.method_id !== undefined && excluded.has(keyOf(e))) {
      dropped.add(e.id);
      continue;
    }
    if (e.event === "return" && dropped.has(e.parent_id)) continue;
    events.push(e);
  }
  return { appmap: { ...appmap, events }, pruned };
}
