import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildAppMap,
  buildClassMap,
  DEFAULT_LIMITS,
  EVENTS_PATH,
  linearize,
  RECORD_PATH,
  sweepEvents,
  VALUE_MAX_LENGTH,
  type Event,
  type Metadata,
  type RecordingLimits,
  type StopReason,
} from "@mapa/format";
import { writeRecording, type SavedRecording } from "./recordings.js";

export const DEFAULT_PORT = 47100;
const PORT_ATTEMPTS = 20;

/** Metadata the collector cannot know by itself (app name, frameworks, git...). */
export type BaseMetadata = Omit<Metadata, "mapa">;

export interface CollectorOptions {
  projectRoot: string;
  metadata: () => BaseMetadata;
  limits?: Partial<RecordingLimits>;
  port?: number;
  log?: (message: string) => void;
  /** How long Stop waits for the last batches the recorders are still sending (ms). */
  drainMs?: number;
  /** Runs after each recording is saved (e.g. upload to the site); its result is shown in the status. */
  afterSave?: (saved: SavedRecording) => Promise<UploadStatus | undefined>;
}

/** What happened to the recording after it was saved (shown by the floating button). */
export interface UploadStatus {
  status: "enviando" | "enviada" | "erro" | "local";
  url?: string;
  message?: string;
}

export interface RecordingStatus {
  enabled: boolean;
  started_at?: string;
  elapsed_seconds?: number;
  remaining_seconds?: number;
  event_count?: number;
  /** Size of the raw events received so far (JSON bytes). */
  bytes?: number;
  limits: RecordingLimits;
  /** True between Stop and the file being written. */
  saving?: boolean;
  /** The last recording saved by this collector (shown by the floating button after a Stop). */
  last?: { stopped_by: StopReason; event_count: number; directory: string; stopped_at: string; upload?: UploadStatus };
}

interface ActiveRecording {
  name?: string;
  startedAt: Date;
  /** Raw events per source (each browser tab and the Next server number their events on their own). */
  sources: Map<string, Event[]>;
  eventCount: number;
  bytes: number;
  /** The limit that was reached (events after it are refused). */
  limitHit?: "event-limit" | "size-limit";
  timer: NodeJS.Timeout;
}

export interface Collector {
  url: string;
  port: number;
  status(): RecordingStatus;
  start(name?: string): RecordingStatus;
  stop(reason?: StopReason): Promise<SavedRecording | undefined>;
  close(): Promise<void>;
}

export class RecordingAlreadyRunning extends Error {}

/**
 * Local collector (the AppMap "remote recording" equivalent, see docs/appmap-mapping.md §7).
 * HTTP API, only on 127.0.0.1:
 *   GET    /record  -> status
 *   POST   /record  -> start (409 if already recording)
 *   DELETE /record  -> stop and save (404 if not recording)
 *   POST   /events?source=<id> -> batch of raw events from a recorder (ignored when not recording)
 * The browser recorder calls GET /record and POST /events from the app's page, so local origins get CORS.
 */
export async function startCollector(options: CollectorOptions): Promise<Collector> {
  const limits: RecordingLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const log = options.log ?? (() => {});
  const drainMs = options.drainMs ?? 1000;
  let active: ActiveRecording | undefined;
  /** Recording being stopped: still accepts the last batches during the drain. */
  let draining: ActiveRecording | undefined;
  let stopping: Promise<SavedRecording | undefined> | undefined;
  let last: RecordingStatus["last"];

  function status(): RecordingStatus {
    if (!active) return { enabled: false, limits, ...(stopping ? { saving: true } : {}), ...(last ? { last } : {}) };
    const elapsed = (Date.now() - active.startedAt.getTime()) / 1000;
    return {
      enabled: true,
      started_at: active.startedAt.toISOString(),
      elapsed_seconds: Math.round(elapsed),
      remaining_seconds: Math.max(0, Math.round(limits.maxSeconds - elapsed)),
      event_count: active.eventCount,
      bytes: Math.round(active.bytes),
      limits,
    };
  }

  function start(name?: string): RecordingStatus {
    if (active) throw new RecordingAlreadyRunning();
    const timer = setTimeout(() => {
      log(`Gravação parada: atingiu o limite de ${limits.maxSeconds} segundos. O que foi gravado foi salvo.`);
      void stop("time-limit");
    }, limits.maxSeconds * 1000);
    timer.unref();
    active = { name, startedAt: new Date(), sources: new Map(), eventCount: 0, bytes: 0, timer };
    log(`Gravação iniciada (para sozinha em ${limits.maxSeconds} segundos).`);
    return status();
  }

  async function stop(reason: StopReason = "user"): Promise<SavedRecording | undefined> {
    if (stopping) return stopping;
    if (!active) return undefined;
    stopping = finish(reason);
    try {
      return await stopping;
    } finally {
      stopping = undefined;
    }
  }

  async function finish(reason: StopReason): Promise<SavedRecording | undefined> {
    if (!active) return undefined;
    const recording = active;
    active = undefined;
    clearTimeout(recording.timer);
    const stoppedAt = new Date();
    draining = recording;
    if (drainMs > 0) await new Promise((resolve) => setTimeout(resolve, drainMs));
    draining = undefined;
    const sources = [...recording.sources].map(([source, events]) => ({ source, events }));
    const { events, incomplete } = linearize(sources, stoppedAt.getTime() / 1000);
    sweepEvents(events);
    const base = options.metadata();
    const metadata: Metadata = {
      ...base,
      ...(recording.name ? { name: recording.name } : {}),
      // Every captured value was cut to the length the AppMap spec recommends.
      trimmed: { version: base.client.version ?? "0.0.0", max_length: VALUE_MAX_LENGTH },
      mapa: {
        started_at: recording.startedAt.toISOString(),
        stopped_at: stoppedAt.toISOString(),
        stopped_by: reason,
        limits,
        ...(incomplete ? { incomplete_calls: incomplete } : {}),
      },
    };
    const saving = writeRecording(options.projectRoot, buildAppMap(metadata, events, buildClassMap(events)), recording.startedAt, recording.name);
    const saved = await saving;
    const current = { stopped_by: reason, event_count: saved.event_count, directory: saved.directory, stopped_at: stoppedAt.toISOString() } as NonNullable<RecordingStatus["last"]>;
    last = current;
    log(`Gravação salva em ${saved.directory} (${saved.event_count} eventos).`);
    if (options.afterSave) {
      // In the background: Stop answers as soon as the file is on disk.
      current.upload = { status: "enviando" };
      void options.afterSave(saved).then(
        (upload) => (upload ? (current.upload = upload) : delete current.upload),
        (error: unknown) => (current.upload = { status: "erro", message: error instanceof Error ? error.message : String(error) }),
      );
    }
    return saved;
  }

  function receive(source: string, batch: unknown, bytes: number) {
    const recording = active ?? draining;
    if (!recording || !Array.isArray(batch)) return;
    const list = recording.sources.get(source) ?? [];
    recording.sources.set(source, list);
    // Limits are strict: a big batch (e.g. a synchronous loop) is cut where the limit is reached.
    // Calls cut without their return get a synthetic one when the file is written.
    const bytesPerEvent = batch.length ? bytes / batch.length : 0;
    for (const event of batch) {
      if (recording.eventCount >= limits.maxEvents) {
        recording.limitHit = "event-limit";
        break;
      }
      if (recording.bytes + bytesPerEvent > limits.maxMegabytes * 1_000_000) {
        recording.limitHit = "size-limit";
        break;
      }
      if (!isRawEvent(event)) continue;
      list.push(event);
      recording.eventCount++;
      recording.bytes += bytesPerEvent;
    }
    if (active !== recording) return;
    if (!recording.limitHit && recording.eventCount >= limits.maxEvents) recording.limitHit = "event-limit";
    if (!recording.limitHit && recording.bytes >= limits.maxMegabytes * 1_000_000) recording.limitHit = "size-limit";
    if (recording.limitHit === "event-limit") {
      log(`Gravação parada: atingiu o limite de ${limits.maxEvents} eventos. O que foi gravado foi salvo.`);
      void stop("event-limit");
    } else if (recording.limitHit === "size-limit") {
      log(`Gravação parada: atingiu o limite de ${limits.maxMegabytes} MB. O que foi gravado foi salvo.`);
      void stop("size-limit");
    }
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log(`Erro no coletor: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    // Reject requests whose Host is not local (protects against DNS rebinding from web pages).
    if (!isLocalHost(req.headers.host)) return sendJson(res, 403, { error: "forbidden host" });

    // Pages of other sites must not talk to the collector: only local origins (the app in dev).
    const origin = req.headers.origin;
    if (origin !== undefined && !isLocalOrigin(origin)) return sendJson(res, 403, { error: "forbidden origin" });
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET, POST, DELETE");
      res.setHeader("access-control-allow-headers", "content-type");
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (url.pathname === EVENTS_PATH && req.method === "POST") {
      const source = url.searchParams.get("source") ?? "unknown";
      const { value, bytes } = await readBodyWithSize(req, MAX_EVENTS_BODY_BYTES);
      receive(source.slice(0, 80), value, bytes);
      res.writeHead(204).end();
      return;
    }
    if (url.pathname !== RECORD_PATH) return sendJson(res, 404, { error: "not found" });

    switch (req.method) {
      case "GET":
        return sendJson(res, 200, status());
      case "POST": {
        const body = asObject(await readBody(req, MAX_BODY_BYTES));
        const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
        try {
          return sendJson(res, 200, start(name));
        } catch (error) {
          if (error instanceof RecordingAlreadyRunning) return sendJson(res, 409, { error: "recording already in progress" });
          throw error;
        }
      }
      case "DELETE": {
        const saved = await stop("user");
        if (!saved) return sendJson(res, 404, { error: "no recording in progress" });
        return sendJson(res, 200, saved);
      }
      default:
        return sendJson(res, 405, { error: "method not allowed" });
    }
  }

  const port = await listen(server, options.port ?? DEFAULT_PORT, options.port === undefined ? PORT_ATTEMPTS : 1);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    status,
    start,
    stop,
    async close() {
      await stop("shutdown");
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(server: http.Server, firstPort: number, attempts: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = firstPort;
    const tryListen = () => {
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        resolve((server.address() as AddressInfo).port);
      });
    };
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && port < firstPort + attempts - 1) {
        port += 1;
        tryListen();
      } else reject(error);
    };
    tryListen();
  });
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, host } = new URL(origin);
    return (protocol === "http:" || protocol === "https:") && isLocalHost(host);
  } catch {
    return false;
  }
}

function isRawEvent(value: unknown): value is Event {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<Event>;
  return typeof e.id === "number" && typeof e.thread_id === "number" && (e.event === "call" || (e.event === "return" && typeof e.parent_id === "number"));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_BODY_BYTES = 16 * 1024 * 1024;

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  return (await readBodyWithSize(req, maxBytes)).value;
}

async function readBodyWithSize(req: http.IncomingMessage, maxBytes: number): Promise<{ value: unknown; bytes: number }> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return { value: undefined, bytes: 0 };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown, bytes: size };
  } catch {
    return { value: undefined, bytes: size };
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
