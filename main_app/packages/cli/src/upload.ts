// Sending a recording to the person's account (CLAUDE.md §4 item 7 and Etapa 5). Rules:
//   - nothing is sent without login (`mapa login`);
//   - the first time, per project, the person confirms (`mapa upload` asks; then Stop sends by itself);
//   - files go straight to the private bucket through signed upload URLs made by the site.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { gunzipSync } from "node:zlib";
import { MAPA_DIR, RECORDINGS_DIR } from "@mapa/collector";
import type { AppMap } from "@mapa/format";
import { projectRefFromUrl } from "@mapa/supabase";
import { api, readCredentials, siteUrl, type Credentials } from "./account.js";
import { findNextProject, MapaError, type NextProject } from "./project.js";
import { say, warn } from "./output.js";

const SETTINGS_FILE = join(MAPA_DIR, "settings.json");
const FILES = { "recording.appmap.json.gz": "application/gzip", "interactions.json": "application/json" } as const;

export interface UploadResult {
  status: "enviada" | "erro";
  id?: string;
  url?: string;
  message?: string;
  at: string;
}

interface Settings {
  /** "auto": the person agreed to send this project's recordings to their account. */
  upload?: "auto";
}

function readSettings(root: string): Settings {
  try {
    return JSON.parse(readFileSync(join(root, SETTINGS_FILE), "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function uploadConsented(root: string): boolean {
  return readSettings(root).upload === "auto";
}

async function saveConsent(root: string) {
  await mkdir(join(root, MAPA_DIR), { recursive: true });
  await writeFile(join(root, SETTINGS_FILE), `${JSON.stringify({ ...readSettings(root), upload: "auto" }, null, 2)}\n`);
}

/** Ref of the Supabase project the app talks to, from NEXT_PUBLIC_SUPABASE_URL in its env files (only the URL is read). */
export function supabaseRef(root: string): string | undefined {
  for (const file of [".env.local", ".env.development.local", ".env.development", ".env"]) {
    try {
      const url = /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^"'\s#]+)/m.exec(readFileSync(join(root, file), "utf8"))?.[1];
      const ref = projectRefFromUrl(url);
      if (ref) return ref;
    } catch {
      // file missing
    }
  }
  return undefined;
}

export function projectName(project: NextProject): string {
  return project.packageJson.name || basename(project.root);
}

/** Uploads one recording folder and writes `upload.json` next to it. Never throws. */
export async function uploadRecording(project: NextProject, directory: string, credentials: Credentials): Promise<UploadResult> {
  let result: UploadResult;
  try {
    const gz = readFileSync(join(directory, "recording.appmap.json.gz"));
    const appmap = JSON.parse(gunzipSync(gz).toString("utf8")) as AppMap;
    const site = siteUrl(credentials);
    const created = await api<{ id: string; url: string; uploads: { file: keyof typeof FILES; url: string; content_type: string }[] }>(site, "/api/cli/recordings", {
      token: credentials.token,
      body: {
        project: { name: projectName(project), ...(supabaseRef(project.root) ? { supabase_ref: supabaseRef(project.root) } : {}) },
        recording: {
          name: appmap.metadata.name,
          started_at: appmap.metadata.mapa?.started_at,
          stopped_at: appmap.metadata.mapa?.stopped_at,
          stopped_by: appmap.metadata.mapa?.stopped_by,
          event_count: appmap.events.length,
          size_bytes: gunzipSync(gz).length,
          gzip_bytes: gz.length,
          metadata: appmap.metadata,
        },
      },
    });
    for (const upload of created.uploads) {
      const body = readFileSync(join(directory, upload.file));
      const res = await fetch(upload.url, { method: "PUT", body, headers: { "content-type": upload.content_type, "x-upsert": "false" } }).catch(() => undefined);
      if (!res?.ok) throw new MapaError(`Não consegui enviar o arquivo ${upload.file} (resposta ${res?.status ?? "sem conexão"}).`);
    }
    const done = await api<{ url: string }>(site, `/api/cli/recordings/${created.id}/complete`, { method: "POST", body: {}, token: credentials.token });
    result = { status: "enviada", id: created.id, url: done.url, at: new Date().toISOString() };
  } catch (error) {
    result = { status: "erro", message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() };
  }
  await writeFile(join(directory, "upload.json"), `${JSON.stringify(result, null, 2)}\n`).catch(() => {});
  return result;
}

/** `mapa upload [gravação] [--pendentes]`: sends the latest (or a given) recording, or all not yet sent. */
export async function upload(args: string[]): Promise<number> {
  const project = findNextProject(process.cwd());
  const credentials = readCredentials();
  if (!credentials) throw new MapaError("Este computador não está conectado a uma conta. Rode `npx mapa login` primeiro.");

  if (!uploadConsented(project.root)) {
    if (!process.stdin.isTTY) throw new MapaError("Para confirmar o primeiro envio deste projeto, rode `npx mapa upload` num terminal.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `[mapa] Enviar as gravações do projeto "${projectName(project)}" para a conta ${credentials.email ?? ""}?\n` +
        "       Elas vão com senhas, tokens, chaves e e-mails mascarados. Depois desta confirmação, cada Stop envia sozinho. (s/N) ",
    );
    rl.close();
    if (!/^s(im)?$/i.test(answer.trim())) {
      say("Nada foi enviado. As gravações continuam só neste computador.");
      return 1;
    }
    await saveConsent(project.root);
  }

  const dir = join(project.root, RECORDINGS_DIR);
  const all = existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "recording.appmap.json.gz"))).sort() : [];
  const target = args.find((a) => !a.startsWith("--"));
  let chosen: string[];
  if (args.includes("--pendentes")) chosen = all.filter((name) => !sent(join(dir, name)));
  else if (target) chosen = all.filter((name) => name === target || join(dir, name) === target);
  else chosen = all.slice(-1);
  if (!chosen.length) throw new MapaError(target ? `Não encontrei a gravação "${target}".` : "Nada para enviar.");

  let failures = 0;
  for (const name of chosen) {
    const result = await uploadRecording(project, join(dir, name), credentials);
    if (result.status === "enviada") say(`Enviada: ${name} → ${result.url}`);
    else {
      failures++;
      warn(`Não consegui enviar ${name}: ${result.message}`);
    }
  }
  return failures ? 1 : 0;
}

function sent(directory: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(directory, "upload.json"), "utf8")) as UploadResult).status === "enviada";
  } catch {
    return false;
  }
}
