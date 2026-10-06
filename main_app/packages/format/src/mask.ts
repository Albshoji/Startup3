// Masking of secrets and personal data (CLAUDE.md §9.2: always on). Applied by the recorders
// at capture time, so sensitive values never reach the collector (docs/appmap-mapping.md §3).
import { summarize, VALUE_MAX_LENGTH } from "./values.js";

export const MASKED = "[mascarado]";

const SECRET_NAME = /pass(word)?|senha|token|secret|api_?key|authorization|cookie|refresh|cpf|card|cart(a|ã)o|cvv/i;
const EMAIL_NAME = /e-?mail/i;
const SECRET_KEY_IN_TEXT =
  /((?:pass(?:word)?|senha|token|secret|api_?key|authorization|cookie|refresh|cpf|cvv|card|cart[aã]o)\w*"?\s*[:=]\s*)("(?:[^"\\]|\\.)*"?|[^,}\]\s&]+)/gi;
const EMAIL = /[^\s"'@,{}[\]=&]+@[^\s"'@,{}[\]=&]+\.[^\s"'@,{}[\]=&]+/g;
// Also catches tokens cut in the middle by summarizing (header + start of the payload).
const JWT = /eyJ[\w-]{4,}(?:\.[\w-]*){0,2}/g;
// New Supabase API keys (not JWTs) and bearer values.
const API_KEY = /\bsb_(?:publishable|secret)_[\w-]*/g;
const BEARER = /\b(Bearer\s+)[\w.~+/=-]+/gi;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

/** True when a parameter/field name says its value is secret (`senha`, `apiKey`, `token`...). */
export function isSecretName(name: string | undefined, extraFields: readonly string[] = []): boolean {
  if (!name) return false;
  return SECRET_NAME.test(name) || extraFields.some((field) => field.toLowerCase() === name.toLowerCase());
}

/**
 * Masks an already-summarized value: whole value when the name is secret, otherwise secret
 * keys inside it (`{password: "x"}`), tokens, e-mails, CPFs and card numbers.
 */
export function maskSummary(name: string | undefined, summary: string, extraFields: readonly string[] = []): string {
  if (isSecretName(name, extraFields)) return MASKED;
  return maskFreeText(summary.replace(BEARER, "$1[token]").replace(SECRET_KEY_IN_TEXT, `$1"${MASKED}"`));
}

function maskFreeText(text: string): string {
  return text
    .replace(BEARER, "$1[token]")
    .replace(JWT, "[token]")
    .replace(API_KEY, "[chave]")
    .replace(EMAIL, "[e-mail]")
    .replace(CPF, "[cpf]")
    .replace(CARD, (match) => (looksLikeCard(match) ? "[cartão]" : match));
}

/**
 * Masks a request/response body or any text: JSON is walked key by key (secret keys masked,
 * e-mail keys replaced), anything else goes through the text rules.
 */
export function maskText(text: string, extraFields: readonly string[] = []): string {
  if (text === "") return text;
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(maskJson(JSON.parse(text), "", extraFields));
    } catch {
      // not JSON after all
    }
  }
  return maskFreeText(text.replace(BEARER, "$1[token]").replace(SECRET_KEY_IN_TEXT, `$1"${MASKED}"`));
}

/** Masks a parsed JSON value (objects, arrays, strings) by key name and content. */
export function maskJson(value: unknown, key = "", extraFields: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => maskJson(item, key, extraFields));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSecretName(k, extraFields) && v !== null && v !== undefined && v !== "") out[k] = MASKED;
      else if (EMAIL_NAME.test(k) && typeof v === "string" && v) out[k] = "[e-mail]";
      else out[k] = maskJson(v, k, extraFields);
    }
    return out;
  }
  if (typeof value === "string") return isSecretName(key, extraFields) ? MASKED : maskFreeText(value);
  return value;
}

/**
 * Final value of an AppMap parameter: summarized generously, masked, then cut to the 100
 * characters the AppMap schema allows (`parameter.value.maxLength`). Masking before cutting
 * means a secret is never half-visible.
 */
export function parameterValue(name: string | undefined, value: unknown, extraFields: readonly string[] = []): string {
  return clipValue(maskSummary(name, summarize(value, 1000), extraFields));
}

/** Masks a text (body, frame) and cuts it to the AppMap limit. */
export function textValue(text: string, extraFields: readonly string[] = []): string {
  return clipValue(maskText(text.length > 4000 ? text.slice(0, 4000) : text, extraFields));
}

export function clipValue(text: string): string {
  return text.length > VALUE_MAX_LENGTH ? text.slice(0, VALUE_MAX_LENGTH - 1) + "…" : text;
}

/** Luhn-valid 15/16 digits, or 13–19 digits written with separators (avoids masking timestamps). */
function looksLikeCard(text: string): boolean {
  const digits = text.replace(/\D/g, "");
  const separated = digits.length !== text.trim().length;
  if (!separated && digits.length !== 15 && digits.length !== 16) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
