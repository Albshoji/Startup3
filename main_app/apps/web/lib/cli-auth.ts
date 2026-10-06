// Login of the `mapa` command (device code flow, like `gh auth login`, RFC 8628):
//   1. the CLI asks for a code (POST /api/cli/device) and shows the short one to the person;
//   2. the person, logged into the site, types it at /dispositivo and approves this computer;
//   3. the CLI, polling POST /api/cli/token, receives its own token.
// Only hashes of the device code and of the token are stored; the token lives in the person's computer.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const DEVICE_CODE_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 3;
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"; // no vowels (no words), no 0/O/1/I

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function newDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function newUserCode(): string {
  const pick = () => Array.from({ length: 4 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

/** Accepts "abcd2345", "ABCD 2345", "abcd-2345"... */
export function normalizeUserCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function newCliToken(): string {
  return `mapa_${randomBytes(32).toString("base64url")}`;
}

export interface CliCaller {
  userId: string;
  tokenId: string;
}

/** Reads `Authorization: Bearer mapa_…`, checks it is a live token, and records its use. */
export async function authenticateCli(request: Request): Promise<CliCaller | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(mapa_[\w-]{20,})$/.exec(header)?.[1];
  if (!token) return null;
  const admin = supabaseAdmin();
  const { data } = await admin.from("cli_tokens").select("id, user_id").eq("token_hash", sha256(token)).is("revoked_at", null).maybeSingle();
  if (!data) return null;
  await admin.from("cli_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { userId: data.user_id, tokenId: data.id };
}

/** JSON error in Portuguese for the CLI (shown to the person as is). */
export function cliError(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

/** Base URL of the site, as the CLI reached it. */
export function siteOrigin(request: Request): string {
  return process.env.MAPA_SITE_URL ?? new URL(request.url).origin;
}
