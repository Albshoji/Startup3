// Connection of this computer to a Mapa account (CLAUDE.md §4 item 3): the token lives outside the
// project, in the person's config folder, readable only by them.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MapaError } from "./project.js";

/** Site used when nothing else is configured. The production address comes with hosting (later stage). */
export const DEFAULT_SITE = "http://localhost:3300";

export interface Credentials {
  site: string;
  token: string;
  email: string | null;
  created_at: string;
}

export function configDir(): string {
  if (process.env.MAPA_CONFIG_DIR) return process.env.MAPA_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "mapa");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "mapa");
}

const credentialsFile = () => join(configDir(), "credentials.json");

export function readCredentials(): Credentials | undefined {
  try {
    const parsed = JSON.parse(readFileSync(credentialsFile(), "utf8")) as Credentials;
    return typeof parsed.token === "string" && typeof parsed.site === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveCredentials(credentials: Credentials): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(credentialsFile(), JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function deleteCredentials(): void {
  rmSync(credentialsFile(), { force: true });
}

export function siteUrl(credentials?: Credentials): string {
  return (process.env.MAPA_SITE_URL || credentials?.site || DEFAULT_SITE).replace(/\/+$/, "");
}

export class ApiError extends MapaError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

/** JSON call to the site's CLI API. Errors carry the site's message (already in Portuguese). */
export async function api<T>(site: string, path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${site}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new MapaError(`Não consegui falar com o site do Mapa (${site}). Verifique a internet e tente de novo.`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(data.message ?? `O site do Mapa respondeu com erro ${res.status}.`, res.status, data.error);
  return data as T;
}
