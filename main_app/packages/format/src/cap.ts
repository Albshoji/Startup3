// Ceiling of recorded calls per function within one user action (one request on the server),
// decided in Etapa 0 (docs/decisions.md): beyond it, calls are only counted and the recording gets
// one `Mapa.omitted` call saying how many were left out. AppMap reaches the same goal after the fact
// (`appmap stats` + excluding functions with too many calls, automatic pruning of large maps);
// Mapa does it at capture time so loops cannot blow the size limits (docs/spike-report.md, risk 4).
import type { FunctionMeta } from "./protocol.js";
import type { CallEvent, Parameter } from "./types.js";
import { SYNTHETIC_PATHS } from "./types.js";

interface Entry {
  meta: FunctionMeta;
  recorded: number;
  omitted: number;
  /** Where the first omitted call would have been (nearest recorded ancestor). */
  parentId?: number;
  timestamp: number;
}

export interface OmittedCalls {
  meta: FunctionMeta;
  omitted: number;
  parentId?: number;
  timestamp: number;
}

export class CallCap {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly max: number) {}

  private entry(meta: FunctionMeta, timestamp: number): Entry {
    const key = `${meta.path}:${meta.lineno}:${meta.klass}.${meta.id}`;
    let entry = this.entries.get(key);
    if (!entry) this.entries.set(key, (entry = { meta, recorded: 0, omitted: 0, timestamp }));
    return entry;
  }

  /** True when this call may be recorded; otherwise it is counted as omitted. */
  admit(meta: FunctionMeta, parentId: number | undefined, timestamp: number): boolean {
    const entry = this.entry(meta, timestamp);
    if (entry.recorded < this.max) {
      entry.recorded++;
      return true;
    }
    this.omit(entry, parentId, timestamp);
    return false;
  }

  /** A call made inside an omitted call: omitted too, but counted under its own function. */
  noteOmitted(meta: FunctionMeta, parentId: number | undefined, timestamp: number): void {
    this.omit(this.entry(meta, timestamp), parentId, timestamp);
  }

  private omit(entry: Entry, parentId: number | undefined, timestamp: number) {
    if (entry.omitted === 0) {
      entry.parentId = parentId;
      entry.timestamp = timestamp;
    }
    entry.omitted++;
  }

  /** Functions with omitted calls (then forgets them, so each is reported once). */
  take(): OmittedCalls[] {
    const out: OmittedCalls[] = [];
    for (const entry of this.entries.values()) {
      if (entry.omitted > 0) {
        out.push({ meta: entry.meta, omitted: entry.omitted, ...(entry.parentId !== undefined ? { parentId: entry.parentId } : {}), timestamp: entry.timestamp });
        entry.omitted = 0;
      }
    }
    return out;
  }
}

/** The synthetic call that reports omitted calls (`Mapa.omitted`, label `mapa.omitted`). */
export function omittedCall(summary: OmittedCalls, base: Pick<CallEvent, "id" | "thread_id" | "layer">): CallEvent {
  const { meta } = summary;
  const parameters: Parameter[] = [
    { name: "function", class: "String", value: `${meta.klass}.${meta.id}`.slice(0, 100) },
    { name: "location", class: "String", value: `${meta.path}:${meta.lineno}`.slice(0, 100) },
    { name: "omitted_calls", class: "Number", value: String(summary.omitted) },
  ];
  const call: CallEvent = {
    ...base,
    event: "call",
    timestamp: summary.timestamp,
    defined_class: "Mapa",
    method_id: "omitted",
    path: SYNTHETIC_PATHS.recorder,
    static: true,
    labels: ["mapa.omitted"],
    parameters,
  };
  if (summary.parentId !== undefined) call.parent_id = summary.parentId;
  return call;
}

/** Pseudo function used to apply the ceiling to `console.*` calls. */
export function consoleMeta(level: string): FunctionMeta {
  return { id: level, klass: "console", path: SYNTHETIC_PATHS.console, lineno: 0, static: true, async: false, params: [], labels: ["log"], pkg: -1, shallow: false };
}
