// Masking of secrets and personal data (CLAUDE.md §9.2: always on). Applied by the recorders
// at capture time, so sensitive values never reach the collector (docs/appmap-mapping.md §3).

export const MASKED = "[mascarado]";

const SECRET_NAME = /pass(word)?|senha|token|secret|api_?key|authorization|cookie|refresh|cpf|card|cart(a|ã)o|cvv/i;
const SECRET_KEY_IN_TEXT =
  /((?:pass(?:word)?|senha|token|secret|api_?key|authorization|cookie|refresh|cpf|cvv|card|cart[aã]o)\w*"?\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,}\]\s]+)/gi;
const EMAIL = /[^\s"'@,{}[\]]+@[^\s"'@,{}[\]]+\.[^\s"'@,{}[\]]+/g;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
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
  return summary
    .replace(SECRET_KEY_IN_TEXT, `$1"${MASKED}"`)
    .replace(JWT, "[token]")
    .replace(EMAIL, "[e-mail]")
    .replace(CPF, "[cpf]")
    .replace(CARD, (match) => (looksLikeCard(match) ? "[cartão]" : match));
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
