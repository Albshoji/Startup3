// SPIKE — masks secrets and personal data in request/response bodies BEFORE summarizing.
const SECRET_KEY = /pass(word)?|senha|token|secret|api_?key|authorization|cookie|refresh|cpf|card|cart(a|ã)o|cvv/i;
const EMAIL_KEY = /e-?mail/i;
const EMAIL_VALUE = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/g;
const JWT_VALUE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

function maskValue(key, value) {
  if (typeof value === "string") {
    if (SECRET_KEY.test(key)) return "[mascarado]";
    if (EMAIL_KEY.test(key)) return "[e-mail]";
    return value.replace(JWT_VALUE, "[token]").replace(EMAIL_VALUE, "[e-mail]");
  }
  if (value && typeof value === "object" && SECRET_KEY.test(key)) return "[mascarado]";
  return value;
}

function walk(node, key = "") {
  if (Array.isArray(node)) return node.map((v) => walk(v, key));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(maskValue(k, v), k);
    return out;
  }
  return maskValue(key, node);
}

export function maskText(text) {
  if (typeof text !== "string" || text === "") return text;
  try {
    return JSON.stringify(walk(JSON.parse(text)));
  } catch {
    return text
      .replace(/("?(?:password|senha|access_token|refresh_token|apikey)"?\s*[:=]\s*)"?[^"&,}\s]+"?/gi, '$1"[mascarado]"')
      .replace(JWT_VALUE, "[token]")
      .replace(EMAIL_VALUE, "[e-mail]");
  }
}

// Masks an already-summarized value (e.g. `{email: "a@b.c", password: "x"}`) and
// whole parameters whose name is sensitive (e.g. `senha`).
export function maskSummary(name, summary) {
  if (name && SECRET_KEY.test(name)) return "[mascarado]";
  if (typeof summary !== "string") return summary;
  return summary
    .replace(/((?:pass(?:word)?|senha|token|secret|api_?key|authorization|cookie|refresh|cpf|cvv)\w*"?\s*:\s*)("[^"]*"?|[^,}\s]+)/gi, '$1"[mascarado]"')
    .replace(JWT_VALUE, "[token]")
    .replace(EMAIL_VALUE, "[e-mail]");
}
