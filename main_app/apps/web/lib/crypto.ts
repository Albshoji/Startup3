// Encryption of the OAuth tokens of the person's Supabase account (CLAUDE.md §7.4: only in the
// site's server, encrypted). AES-256-GCM; the key is only in the server's environment.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.MAPA_TOKEN_ENCRYPTION_KEY;
  const buffer = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (buffer.length !== 32) throw new Error("MAPA_TOKEN_ENCRYPTION_KEY precisa ter 32 bytes em base64 (veja apps/web/.env.example).");
  return buffer;
}

/** "v1.<iv>.<tag>.<ciphertext>" in base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("token criptografado em formato desconhecido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
