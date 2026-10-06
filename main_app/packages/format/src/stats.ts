// Statistics of a recording, like `appmap stats` (referencias/appmap-js/packages/cli/src/cmds/stats:
// count and estimated size per function, most called first), plus the calls Mapa omitted at capture
// time (`Mapa.omitted`) and the exclusions to suggest (AppMap's refining guide uses 75 calls as the
// example threshold).
import { SYNTHETIC_PATHS, type AppMap, type CallEvent, type Event } from "./types.js";

export const EXCLUDE_SUGGESTION_THRESHOLD = 75;

export interface FunctionStats {
  /** `Class.method` (or `file.function`). */
  function: string;
  location: string;
  /** Calls recorded in the file. */
  count: number;
  /** Calls left out by the per-action ceiling. */
  omitted: number;
  /** Estimated bytes of the recorded calls and returns (JSON). */
  size: number;
  /** Name to put in `exclude` of `.mapa/config.json` (appmap.yml semantics), when it is user code. */
  exclude?: string;
  path?: string;
}

export interface RecordingStats {
  events: number;
  bytes: number;
  byLayer: Record<string, number>;
  functions: FunctionStats[];
  suggestions: FunctionStats[];
}

export function computeStats(appmap: AppMap): RecordingStats {
  const returns = new Map<number, Event>();
  for (const event of appmap.events) if (event.event === "return") returns.set(event.parent_id, event);

  const byKey = new Map<string, FunctionStats>();
  const byLayer: Record<string, number> = {};
  const entry = (call: Pick<CallEvent, "defined_class" | "method_id" | "path" | "lineno">) => {
    const name = `${call.defined_class}.${call.method_id}`;
    const location = call.lineno !== undefined ? `${call.path}:${call.lineno}` : call.path ?? "";
    const key = `${name}@${location}`;
    let stats = byKey.get(key);
    if (!stats) {
      stats = { function: name, location, count: 0, omitted: 0, size: 0 };
      if (call.path && !call.path.startsWith("mapa:")) {
        stats.path = call.path;
        // Loose functions have the file name as class: exclude by name; methods by Class.method.
        const fileBase = call.path.split("/").pop()!.replace(/\.[^.]+$/, "");
        stats.exclude = call.defined_class === fileBase ? call.method_id! : name;
      }
      byKey.set(key, stats);
    }
    return stats;
  };

  for (const event of appmap.events) {
    if (event.event !== "call") continue;
    byLayer[event.layer ?? "?"] = (byLayer[event.layer ?? "?"] ?? 0) + 1;
    if (event.method_id === undefined || event.http_client_request || event.http_server_request || event.sql_query) continue;
    if (event.path === SYNTHETIC_PATHS.recorder && event.method_id === "omitted") {
      const fn = event.parameters?.find((p) => p.name === "function")?.value ?? "?";
      const location = event.parameters?.find((p) => p.name === "location")?.value ?? "";
      const [klass, ...rest] = fn.split(".");
      const [path, line] = location.split(/:(\d+)$/);
      const target = entry({ defined_class: klass, method_id: rest.join("."), path, ...(line && Number(line) > 0 ? { lineno: Number(line) } : {}) });
      target.omitted += Number(event.parameters?.find((p) => p.name === "omitted_calls")?.value ?? 0);
      continue;
    }
    const stats = entry(event);
    stats.count++;
    const ret = returns.get(event.id);
    stats.size += JSON.stringify(event).length + (ret ? JSON.stringify(ret).length : 0);
  }

  const functions = [...byKey.values()].sort((a, b) => b.count + b.omitted - (a.count + a.omitted) || b.size - a.size);
  return {
    events: appmap.events.length,
    bytes: JSON.stringify(appmap).length,
    byLayer,
    functions,
    suggestions: functions.filter((f) => f.exclude && f.count + f.omitted > EXCLUDE_SUGGESTION_THRESHOLD),
  };
}
