// Side-effect-free summary of runtime values, shared by the browser and server recorders.
// AppMap records `util.inspect(value, {depth: 1})` (appmap-node/src/parameter.ts); there is no
// `util.inspect` in the browser, and the spec recommends values of ~100 characters, so Mapa
// builds its own short summary at capture time (docs/appmap-mapping.md §3).
//
// Rules: never await, never call `then` (Next 16 `params` are Promises that complain when read
// synchronously), never run getters, never recurse deeply.

export const VALUE_MAX_LENGTH = 100;

export function summarize(value: unknown, maxLength = VALUE_MAX_LENGTH): string {
  return clip(describe(value, 0), maxLength);
}

function describe(v: unknown, depth: number): string {
  try {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    switch (typeof v) {
      case "string":
        return JSON.stringify(v.length > VALUE_MAX_LENGTH ? v.slice(0, VALUE_MAX_LENGTH) : v) + (v.length > VALUE_MAX_LENGTH ? "…" : "");
      case "number":
      case "boolean":
        return String(v);
      case "bigint":
        return `${v}n`;
      case "symbol":
        return v.toString();
      case "function":
        return `[Function ${(v as { name?: string }).name || "anonymous"}]`;
    }
    const obj = v as Record<string | symbol, unknown>;
    if (isThenable(obj)) return "Promise";
    if ("$$typeof" in obj && obj.$$typeof) return `[React element ${reactTypeName(obj.type)}]`;
    if (typeof Event !== "undefined" && v instanceof Event) return `[${v.type} event]`;
    const DomNode = (globalThis as { Node?: new () => { nodeName: string } }).Node;
    if (DomNode && v instanceof DomNode) return `[${v.nodeName}]`;
    if (v instanceof Error) return `[${v.name}: ${String(v.message).slice(0, 80)}]`;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
    if (Array.isArray(v)) {
      if (depth > 0) return `[Array(${v.length})]`;
      const items = v.slice(0, 5).map((x) => describe(x, depth + 1));
      return `[${items.join(", ")}${v.length > 5 ? ", …" : ""}]`;
    }
    if (v instanceof Map) return `[Map(${v.size})]`;
    if (v instanceof Set) return `[Set(${v.size})]`;
    const proto = Object.getPrototypeOf(v) as object | null;
    const plain = proto === Object.prototype || proto === null;
    if (!plain) return `[${constructorName(proto)}]`;
    if (depth > 0) return "[Object]";
    const keys = Object.keys(v);
    const parts: string[] = [];
    for (const key of keys.slice(0, 8)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      parts.push(`${key}: ${descriptor && "value" in descriptor ? describe(descriptor.value, depth + 1) : "[getter]"}`);
    }
    return `{${parts.join(", ")}${keys.length > 8 ? ", …" : ""}}`;
  } catch {
    return "[unreadable]";
  }
}

/** AppMap `class` of a parameter: the constructor name, or the primitive type. */
export function classOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "Array";
  if (typeof v !== "object") return typeof v;
  try {
    if (isThenable(v as Record<string, unknown>)) return "Promise";
    return constructorName(Object.getPrototypeOf(v) as object | null);
  } catch {
    return "object";
  }
}

function isThenable(obj: Record<string | symbol, unknown>): boolean {
  // Read through the descriptor chain without triggering getters.
  let proto: object | null = obj;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "then");
    if (descriptor) return "value" in descriptor ? typeof descriptor.value === "function" : true;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}

function constructorName(proto: object | null): string {
  if (!proto) return "Object";
  const descriptor = Object.getOwnPropertyDescriptor(proto, "constructor");
  const ctor = descriptor && "value" in descriptor ? (descriptor.value as { name?: unknown }) : undefined;
  return typeof ctor?.name === "string" && ctor.name ? ctor.name : "Object";
}

function reactTypeName(type: unknown): string {
  if (typeof type === "string") return type;
  if (type && (typeof type === "function" || typeof type === "object")) {
    const t = type as { displayName?: unknown; name?: unknown };
    if (typeof t.displayName === "string") return t.displayName;
    if (typeof t.name === "string" && t.name) return t.name;
  }
  return "?";
}

function clip(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}
