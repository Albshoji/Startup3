// Turns the raw events sent by the recorders into the final `events` array and `classMap`.
//
// The recorders give every `call` an explicit `parent_id` (Mapa extension) and number events
// per source (each browser tab and the Next server count on their own). AppMap readers instead
// rebuild the call tree from the ORDER of events in each thread (appmap-js
// models/src/appMapBuilder/eventStack.js; the validator checks per-thread FIFO order and
// increasing ids). appmap-node gets that order by buffering async continuations
// (appmap-node/src/Recording.ts `fork`); Mapa rebuilds it here from the parent links instead,
// see docs/appmap-mapping.md §4.
import { NO_STATUS, type CallEvent, type ClassMapClass, type ClassMapFunction, type ClassMapPackage, type Event, type Interaction, type ReturnEvent } from "./types.js";

export interface SourceEvents {
  /** e.g. "server" or "browser-<tab id>" */
  source: string;
  events: Event[];
}

interface Node {
  source: string;
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
        calls.set(event.id, { source, call: event, children: [], threadKey: `${source}:${event.thread_id}` });
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
  const finalIds = new Map<string, number>(); // "<source>:<local id>" -> final id
  const objectIds = new Map<string, number>();
  const objectIdFor = (source: string, id: number) => {
    const key = `${source}:${id}`;
    let mapped = objectIds.get(key);
    if (mapped === undefined) objectIds.set(key, (mapped = objectIds.size + 1));
    return mapped;
  };
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
    finalIds.set(`${node.source}:${node.call.id}`, callId);
    out.push({ ...rest, id: callId, thread_id: thread });

    node.children.sort((a, b) => a.call.id - b.call.id); // same source: local ids follow call order
    for (const child of node.children) visit(child, threadKey);

    if (node.ret) {
      const ret: ReturnEvent = { ...node.ret, id: nextId++, thread_id: thread, parent_id: callId };
      // Object ids are counted per source: renumber them so a browser error and a server error never share one.
      if (ret.exceptions) ret.exceptions = ret.exceptions.map((e) => (e.object_id === undefined ? e : { ...e, object_id: objectIdFor(node.source, e.object_id) }));
      out.push(ret);
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
        ...(node.call.http_client_request ? { http_client_response: { status_code: NO_STATUS } } : {}),
        ...(node.call.http_server_request ? { http_server_response: { status_code: NO_STATUS } } : {}),
      });
    }
  };
  for (const root of roots) visit(root, root.threadKey);

  // Links across threads (browser fetch → server request) now point to final ids.
  for (const event of out) {
    if (event.event !== "call" || !event.remote_parent) continue;
    const target = finalIds.get(`${event.remote_parent.source}:${event.remote_parent.id}`);
    delete event.remote_parent;
    if (target !== undefined) event.remote_parent_id = target;
  }
  linkPageLoads(out);

  return { events: out, incomplete };
}

/**
 * A page load is requested by the browser itself, so the document request cannot carry
 * `traceparent`. The server request that served it is tied to the browser's "carregar" action by
 * path and time (the action starts when the navigation started), marked as inferred.
 */
function linkPageLoads(events: Event[]) {
  const used = new Set<number>();
  const documents = events.filter(
    (e): e is CallEvent =>
      e.event === "call" &&
      e.http_server_request?.request_method === "GET" &&
      e.remote_parent_id === undefined &&
      (e.http_server_request.headers?.accept ?? "").includes("text/html"),
  );
  for (const action of events) {
    if (action.event !== "call" || action.method_id !== "navigate" || !action.labels?.includes("mapa.user-action")) continue;
    if (!action.parameters?.[0]?.value.startsWith("carregar ")) continue;
    const url = action.parameters.find((p) => p.name === "url")?.value ?? "";
    const path = url.split("?")[0];
    const start = action.timestamp ?? 0;
    const match = documents.find((d) => !used.has(d.id) && d.http_server_request!.path_info === path && (d.timestamp ?? 0) >= start - 0.5 && (d.timestamp ?? 0) <= start + 30);
    if (!match) continue;
    used.add(match.id);
    match.remote_parent_id = action.id;
    match.attribution = "inferred";
  }
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

    // Synthetic calls (mapa:browser, mapa:console...) get a package of their own.
    const folders = event.path.startsWith("mapa:") ? [event.path] : event.path.split("/").slice(0, -1);
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

/**
 * Index of user actions (interactions.json), like AppMap's one-file-per-request recordings but
 * without duplicating events. An action counts the events below it and, through
 * `remote_parent_id`, the server requests it caused.
 */
export function buildInteractions(events: Event[]): Interaction[] {
  const interactions: Interaction[] = [];
  const byCall = new Map<number, Interaction>();
  const ownerOf = new Map<number, Interaction>(); // call id -> interaction
  const stacks = new Map<number, CallEvent[]>();
  for (const event of events) {
    const stack = stacks.get(event.thread_id) ?? [];
    stacks.set(event.thread_id, stack);
    if (event.event === "call") {
      const parent = stack[stack.length - 1];
      let owner = parent ? ownerOf.get(parent.id) : undefined;
      if (!parent && event.labels?.includes("mapa.user-action")) {
        owner = {
          event_id: event.id,
          kind: event.method_id as Interaction["kind"],
          target: event.parameters?.[0]?.value ?? "",
          started_at: event.timestamp ?? 0,
          event_count: 0,
        };
        interactions.push(owner);
        byCall.set(event.id, owner);
      } else if (!parent && event.remote_parent_id !== undefined) {
        owner = ownerOf.get(event.remote_parent_id);
      }
      if (owner) {
        ownerOf.set(event.id, owner);
        owner.event_count++;
      }
      stack.push(event);
    } else {
      const call = stack.pop();
      const owner = call ? ownerOf.get(call.id) : undefined;
      if (owner) owner.event_count++;
      const interaction = call ? byCall.get(call.id) : undefined;
      if (interaction && call?.timestamp !== undefined && event.elapsed !== undefined) {
        interaction.ended_at = call.timestamp + event.elapsed;
      }
    }
  }
  return interactions;
}
