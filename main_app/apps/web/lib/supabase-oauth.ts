// "Conectar Supabase": the Mapa site as an OAuth App of the Supabase Management API, acting on the
// person's behalf, READ-ONLY (CLAUDE.md §7.4). Authorization code + PKCE; tokens encrypted at rest;
// refreshed when about to expire. Every call to the person's project goes through ManagementClient,
// which only allows reads (packages/supabase/src/management.ts).
import { createHash, randomBytes } from "node:crypto";
import { ManagementApiError, ManagementClient, readSchema, type SchemaSnapshot } from "@mapa/supabase";
import { decrypt, encrypt } from "@/lib/crypto";
import { RECORDINGS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

const AUTHORIZE_URL = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
export const STATE_TTL_SECONDS = 600;

function clientCredentials() {
  const id = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const secret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Faltam SUPABASE_OAUTH_CLIENT_ID e SUPABASE_OAUTH_CLIENT_SECRET (veja apps/web/.env.example).");
  return { id, secret };
}

export function redirectUri(origin: string) {
  return `${process.env.MAPA_SITE_URL ?? origin}/conectar-supabase/retorno`;
}

export function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/** PKCE (RFC 7636): verifier kept in our database, challenge sent to Supabase. */
export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(origin: string, state: string, challenge: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientCredentials().id);
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = clientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams(fields),
  });
  const text = await res.text();
  if (!res.ok) throw new ManagementApiError(`token → ${res.status} ${text.slice(0, 200)}`, res.status);
  const data = JSON.parse(text) as Partial<TokenResponse>;
  if (!data.access_token || !data.refresh_token) throw new Error("resposta do Supabase sem tokens");
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: Number(data.expires_in ?? 3600) };
}

export function exchangeCode(origin: string, code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), code_verifier: verifier });
}

/** Saves (encrypted) a fresh pair of tokens for a Mapa project. */
export async function storeTokens(projectId: string, ownerId: string, tokens: TokenResponse) {
  const row = {
    project_id: projectId,
    owner_id: ownerId,
    access_token_enc: encrypt(tokens.access_token),
    refresh_token_enc: encrypt(tokens.refresh_token),
    access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin().from("supabase_connections").upsert(row, { onConflict: "project_id" });
  if (error) throw new Error(`não consegui guardar a conexão: ${error.message}`);
}

export class ConnectionLost extends Error {}

/** A valid access token for the project's connection, refreshing it when it is about to expire. */
async function accessTokenFor(projectId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: connection } = await admin.from("supabase_connections").select("owner_id, access_token_enc, refresh_token_enc, access_expires_at").eq("project_id", projectId).maybeSingle();
  if (!connection) throw new ConnectionLost("Este projeto não está conectado ao Supabase.");
  if (new Date(connection.access_expires_at).getTime() - Date.now() > 60_000) return decrypt(connection.access_token_enc);
  try {
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token_enc) });
    await storeTokens(projectId, connection.owner_id, fresh);
    return fresh.access_token;
  } catch (error) {
    if (error instanceof ManagementApiError && error.status >= 400 && error.status < 500) {
      // Access revoked on Supabase: the tokens are useless, forget them.
      await admin.from("supabase_connections").delete().eq("project_id", projectId);
      throw new ConnectionLost("O acesso ao Supabase foi retirado. Conecte de novo.");
    }
    throw error;
  }
}

export function managementClientFor(projectId: string) {
  return new ManagementClient(() => accessTokenFor(projectId));
}

/** Reads the structure of the chosen Supabase project and keeps it as the connection's latest snapshot. */
export async function refreshSchema(projectId: string): Promise<SchemaSnapshot> {
  const admin = supabaseAdmin();
  const { data: connection } = await admin.from("supabase_connections").select("supabase_ref").eq("project_id", projectId).maybeSingle();
  if (!connection?.supabase_ref) throw new Error("Escolha primeiro qual projeto do Supabase este app usa.");
  const snapshot = await readSchema(managementClientFor(projectId), connection.supabase_ref);
  await admin.from("supabase_connections").update({ schema_snapshot: snapshot, schema_read_at: snapshot.read_at }).eq("project_id", projectId);
  return snapshot;
}

/** Snapshot of the structure stored with a recording (`supabase-schema.json`), when the project is connected. */
export async function snapshotForRecording(projectId: string, recordingId: string, storagePrefix: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data: connection } = await admin.from("supabase_connections").select("supabase_ref").eq("project_id", projectId).maybeSingle();
  if (!connection?.supabase_ref) return false;
  const snapshot = await refreshSchema(projectId);
  const { error } = await admin.storage
    .from(RECORDINGS_BUCKET)
    .upload(`${storagePrefix}supabase-schema.json`, JSON.stringify(snapshot), { contentType: "application/json", upsert: true });
  if (error) return false;
  await admin.from("recordings").update({ has_supabase_schema: true }).eq("id", recordingId);
  return true;
}
