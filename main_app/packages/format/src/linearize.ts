// Turns the raw events sent by the recorders into the final `events` array and `classMap`.
//
// The recorders give every `call` an explicit `parent_id` (Mapa extension) and number events
// per source (each browser tab and the Next server count on their own). AppMap readers instead
// rebuild the call tree from the ORDER of events in each thread (appmap-js
// models/src/appMapBuilder/eventStack.js; the validator checks per-thread FIFO order and
// increasing ids). appmap-node gets that order by buffering async continuations
// (appmap-node/src/Recording.ts `fork`); Mapa rebuilds it here from the parent links instead,
// see docs/appmap-mapping.md §4.
import type { CallEvent, ClassMapClass, ClassMapFunction, ClassMapPackage, Event, ReturnEvent } from "./types.js";

export interface SourceEvents {
  /** e.g. "server" or "browser-<tab id>" */
  source: string;
  events: Event[];
}

interface Node {
  call: CallEvent;
  ret?: ReturnEvent;
  children: Node[];
  threadKey: string;
}

export interface LinearizeResult {
  events: Event[];
  /** Calls with no return when the recording stopped (a synthetic return was added). */
  incomplete: number;
}

export function linearize(sources: SourceEvents[], stoppedAt?: number): LinearizeResult {
  const roots: Node[] = [];
  for (const { source, events } of sources) {
    const calls = new Map<number, Node>();
    for (const event of events) {
      if (event.event === "call") {
        calls.set(event.id, { call: event, children: [], threadKey: `${source}:${event.thread_id}` });
      }
    }
    for (const event of events) {
      if (event.event === "return") {
        const node = calls.get(event.parent_id);
        if (node && !node.ret) node.ret = event; // returns of calls made before Start are dropped
      }
    }
    for (const node of calls.values()) {
      const parent = node.call.parent_id !== undefined ? calls.get(node.call.parent_id) : undefined;
      if (parent) {
        node.threadKey = parent.threadKey; // children always stay on the parent's thread
        parent.children.push(node);
      } else roots.push(node); // parent started before Start (or no parent at all)
    }
  }

  const byStart = (a: Node, b: Node) => (a.call.timestamp ?? 0) - (b.call.timestamp ?? 0) || a.call.id - b.call.id;
  roots.sort(byStart);

  const threadIds = new Map<string, number>();
  const out: Event[] = [];
  let nextId = 1;
  let incomplete = 0;

  const visit = (node: Node, threadKey: string) => {
    let thread = threadIds.get(threadKey);
    if (thread === undefined) {
      thread = threadIds.size + 1;
      threadIds.set(threadKey, thread);
    }
    const callId = nextId++;
    // The AppMap schema forbids `parent_id` on calls: in the final file the tree is given by the
    // order of events in each thread, so the transport-only link is dropped here.
    const { parent_id: _transportOnly, ...rest } = node.call;
    out.push({ ...rest, id: callId, thread_id: thread });

    node.children.sort((a, b) => a.call.id - b.call.id); // same source: local ids follow call order
    for (const child of node.children) visit(child, threadKey);

    if (node.ret) {
      out.push({ ...node.ret, id: nextId++, thread_id: thread, parent_id: callId });
    } else {
      incomplete++;
      const started = node.call.timestamp;
      out.push({
        id: nextId++,
        event: "return",
        thread_id: thread,
        parent_id: callId,
        incomplete: true,
        ...(started !== undefined && stoppedAt !== undefined ? { elapsed: Math.max(0, stoppedAt - started) } : {}),
        ...(node.call.http_client_request ? { http_client_response: { status_code: 0 } } : {}),
        ...(node.call.http_server_request ? { http_server_response: { status_code: 0 } } : {}),
      });
    }
  };
  for (const root of roots) visit(root, root.threadKey);

  return { events: out, incomplete };
}

/**
 * Builds the AppMap `classMap` (package → class → function) from the recorded calls, like
 * appmap-node does from its function registry. Packages follow the folders of the file path.
 */
export function buildClassMap(events: Event[]): ClassMapPackage[] {
  const root: ClassMapPackage = { type: "package", name: "", children: [] };
  const seen = new Set<string>();
  for (const event of events) {
    if (event.event !== "call" || !event.defined_class || !event.method_id || !event.path) continue;
    const location = event.lineno !== undefined ? `${event.path}:${event.lineno}` : event.path;
    const designator = `${event.method_id}\0${location}\0${event.static === true}`;
    if (seen.has(designator)) continue;
    seen.add(designator);

    const folders = event.path.split("/").slice(0, -1);
    let pkg = root;
    for (const folder of folders.length ? folders : ["."]) pkg = child(pkg, "package", folder);
    const klass = child(pkg, "class", event.defined_class);
    const fn: ClassMapFunction = { type: "function", name: event.method_id, location, static: event.static === true };
    if (event.labels?.length) fn.labels = [...event.labels];
    (klass.children ??= []).push(fn);
  }
  return (root.children ?? []) as ClassMapPackage[];
}

function child(parent: ClassMapPackage, type: "package", name: string): ClassMapPackage;
function child(parent: ClassMapPackage, type: "class", name: string): ClassMapClass;
function child(parent: ClassMapPackage, type: "package" | "class", name: string): ClassMapPackage | ClassMapClass {
  const children = (parent.children ??= []);
  const found = children.find((c) => c.type === type && c.name === name);
  if (found) return found;
  const created = { type, name, children: [] } as ClassMapPackage | ClassMapClass;
  children.push(created as ClassMapPackage & ClassMapClass);
  return created;
}
