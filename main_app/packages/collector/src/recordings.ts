import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { buildInteractions, type AppMap } from "@mapa/format";

const gzipAsync = promisify(gzip);

export const MAPA_DIR = ".mapa";
export const RECORDINGS_DIR = join(MAPA_DIR, "recordings");
export const STATE_FILE = join(MAPA_DIR, "collector.json");

export interface SavedRecording {
  directory: string;
  file: string;
  event_count: number;
  stopped_by: string;
  bytes: number;
  gzip_bytes: number;
}

/**
 * Writes .mapa/recordings/<date-time>[-<name>]/ with recording.appmap.json.gz and
 * interactions.json (CLAUDE.md §9.4).
 */
export async function writeRecording(projectRoot: string, appmap: AppMap, startedAt: Date, name?: string): Promise<SavedRecording> {
  const folder = [timestampForPath(startedAt), name ? slug(name) : undefined].filter(Boolean).join("-");
  const directory = join(projectRoot, RECORDINGS_DIR, folder);
  await mkdir(directory, { recursive: true });

  const json = JSON.stringify(appmap);
  const compressed = await gzipAsync(json);
  const file = join(directory, "recording.appmap.json.gz");
  await writeFile(file, compressed);

  const interactions = buildInteractions(appmap.events);
  await writeFile(join(directory, "interactions.json"), JSON.stringify(interactions, null, 2));

  return {
    directory,
    file,
    event_count: appmap.events.length,
    stopped_by: appmap.metadata.mapa?.stopped_by ?? "user",
    bytes: Buffer.byteLength(json),
    gzip_bytes: compressed.length,
  };
}

/** 2026-10-05T14:03:09.123Z -> 2026-10-05_14-03-09 (local time). */
function timestampForPath(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "gravacao"
  );
}

export interface CollectorState {
  url: string;
  port: number;
  pid: number;
  started_at: string;
}

/** The running collector writes where it listens, so `mapa record` can find it. */
export async function writeCollectorState(projectRoot: string, state: CollectorState): Promise<void> {
  await mkdir(join(projectRoot, MAPA_DIR), { recursive: true });
  await writeFile(join(projectRoot, STATE_FILE), JSON.stringify(state, null, 2));
}

export async function readCollectorState(projectRoot: string): Promise<CollectorState | undefined> {
  try {
    return JSON.parse(await readFile(join(projectRoot, STATE_FILE), "utf8")) as CollectorState;
  } catch {
    return undefined;
  }
}

export async function removeCollectorState(projectRoot: string): Promise<void> {
  await rm(join(projectRoot, STATE_FILE), { force: true });
}
