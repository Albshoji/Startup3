// Mapa's own validator of the raw file (CLAUDE.md §8), written from the AppMap specification
// (referencias/appmap/README.md): the rules the site needs before processing a recording.
// (@appland/appmap-validate stays a test-only dependency.)
import type { AppMap, CallEvent, Event } from "./types.js";

export interface ValidationResult {
  /** Problems that make the file unusable. */
  errors: string[];
  /** Problems that do not stop processing (reported, fixed or ignored). */
  warnings: string[];
}

const MAX_REPORTED = 20;

export function validateRecording(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (list: string[], message: string) => {
    if (list.length < MAX_REPORTED) list.push(message);
  };
  if (!input || typeof input !== "object") return { errors: ["o arquivo não é um objeto JSON"], warnings };
  const appmap = input as Partial<AppMap>;
  if (typeof appmap.version !== "string") fail(errors, "falta `version`");
  if (!appmap.metadata || typeof appmap.metadata !== "object") fail(errors, "falta `metadata`");
  if (!Array.isArray(appmap.classMap)) fail(errors, "`classMap` não é uma lista");
  if (!Array.isArray(appmap.events)) {
    fail(errors, "`events` não é uma lista");
    return { errors, warnings };
  }

  const functions = new Set<string>();
  const visit = (node: { type?: string; name?: string; location?: string; static?: boolean; children?: unknown[] }) => {
    if (node.type === "function") functions.add(`${node.name}\0${node.location ?? ""}\0${node.static === true}`);
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  for (const pkg of appmap.classMap ?? []) visit(pkg as never);

  let lastId = 0;
  const stacks = new Map<number, CallEvent[]>();
  for (const event of appmap.events as Event[]) {
    if (!event || typeof event.id !== "number" || typeof event.thread_id !== "number" || (event.event !== "call" && event.event !== "return")) {
      fail(errors, `evento malformado: ${JSON.stringify(event).slice(0, 80)}`);
      continue;
    }
    if (event.id <= lastId) fail(errors, `ids fora de ordem no evento ${event.id}`);
    lastId = event.id;
    const stack = stacks.get(event.thread_id) ?? [];
    stacks.set(event.thread_id, stack);
    if (event.event === "call") {
      if ("parent_id" in event && event.parent_id !== undefined) fail(errors, `call ${event.id} com parent_id (proibido pelo esquema)`);
      if (event.method_id !== undefined) {
        const location = event.lineno !== undefined ? `${event.path}:${event.lineno}` : (event.path ?? "");
        if (!functions.has(`${event.method_id}\0${location}\0${event.static === true}`)) fail(warnings, `função fora do classMap: ${event.defined_class}.${event.method_id}`);
      }
      for (const p of [...(event.parameters ?? []), ...(event.message ?? [])]) {
        if (typeof p.value !== "string" || p.value.length > 100) fail(warnings, `valor de parâmetro inválido ou maior que 100 caracteres no evento ${event.id}`);
      }
      stack.push(event);
    } else {
      const call = stack.pop();
      if (!call) fail(errors, `return ${event.id} sem call aberto na thread ${event.thread_id}`);
      else if (call.id !== event.parent_id) fail(errors, `return ${event.id} aponta para ${event.parent_id}, mas o call aberto é ${call.id}`);
      else if (call.http_client_request && !event.http_client_response) fail(errors, `pedido HTTP ${call.id} sem http_client_response`);
    }
  }
  for (const [thread, stack] of stacks) if (stack.length) fail(warnings, `thread ${thread}: ${stack.length} chamada(s) sem retorno`);
  return { errors, warnings };
}
