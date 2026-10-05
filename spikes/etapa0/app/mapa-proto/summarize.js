// SPIKE — side-effect-safe value summary (shared by both runtimes).
// Never awaits, never stringifies deeply, never touches thenables (Next 16 `params`
// are Promises that complain when read synchronously) nor getters of exotic objects.
export function summarize(v, depth = 0) {
  try {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    const type = typeof v;
    if (type === "string") return v.length > 100 ? JSON.stringify(v.slice(0, 100)) + "…" : JSON.stringify(v);
    if (type === "number" || type === "boolean" || type === "bigint") return String(v);
    if (type === "symbol") return v.toString();
    if (type === "function") return `[Function ${v.name || "anonymous"}]`;
    if (typeof v.then === "function") return "Promise";
    if (v.$$typeof) return `[React element ${typeof v.type === "string" ? v.type : v.type?.displayName || v.type?.name || "?"}]`;
    if (typeof Event !== "undefined" && v instanceof Event) return `[${v.type} event]`;
    if (typeof Node !== "undefined" && v instanceof Node) return `[${v.nodeName}]`;
    if (v instanceof Error) return `[${v.name}: ${String(v.message).slice(0, 80)}]`;
    if (Array.isArray(v)) {
      if (depth > 0) return `[Array(${v.length})]`;
      const s = "[" + v.slice(0, 5).map((x) => summarize(x, depth + 1)).join(", ") + (v.length > 5 ? ", …" : "") + "]";
      return s.length > 100 ? s.slice(0, 100) + "…" : s;
    }
    const proto = Object.getPrototypeOf(v);
    const plain = proto === Object.prototype || proto === null;
    const name = plain ? "" : (proto?.constructor?.name || "Object") + " ";
    if (!plain || depth > 0) return `[${name.trim() || "Object"}]`;
    const keys = Object.keys(v);
    const parts = [];
    for (const k of keys.slice(0, 8)) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      parts.push(`${k}: ${d && "value" in d ? summarize(d.value, depth + 1) : "[getter]"}`);
    }
    const s = `{${parts.join(", ")}${keys.length > 8 ? ", …" : ""}}`;
    return s.length > 100 ? s.slice(0, 100) + "…" : s;
  } catch {
    return "[unreadable]";
  }
}

export function classOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "Array";
  if (typeof v !== "object") return typeof v;
  try {
    if (typeof v.then === "function") return "Promise";
    return Object.getPrototypeOf(v)?.constructor?.name || "Object";
  } catch {
    return "object";
  }
}
