import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildAppMap, DEFAULT_LIMITS, type Event, type Metadata, type RecordingLimits, type StopReason } from "@mapa/format";
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
}

export interface RecordingStatus {
  enabled: boolean;
  started_at?: string;
  elapsed_seconds?: number;
  remaining_seconds?: number;
  event_count?: number;
  limits: RecordingLimits;
}

interface ActiveRecording {
  name?: string;
  startedAt: Date;
  events: Event[];
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
 */
export async function startCollector(options: CollectorOptions): Promise<Collector> {
  const limits: RecordingLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const log = options.log ?? (() => {});
  let active: ActiveRecording | undefined;
  let stopping: Promise<SavedRecording | undefined> | undefined;

  function status(): RecordingStatus {
    if (!active) return { enabled: false, limits };
    const elapsed = (Date.now() - active.startedAt.getTime()) / 1000;
    return {
      enabled: true,
      started_at: active.startedAt.toISOString(),
      elapsed_seconds: Math.round(elapsed),
      remaining_seconds: Math.max(0, Math.round(limits.maxSeconds - elapsed)),
      event_count: active.events.length,
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
    active = { name, startedAt: new Date(), events: [], timer };
    log(`Gravação iniciada (para sozinha em ${limits.maxSeconds} segundos).`);
    return status();
  }

  async function stop(reason: StopReason = "user"): Promise<SavedRecording | undefined> {
    if (stopping) return stopping;
    if (!active) return undefined;
    const recording = active;
    active = undefined;
    clearTimeout(recording.timer);
    const stoppedAt = new Date();
    const metadata: Metadata = {
      ...options.metadata(),
      ...(recording.name ? { name: recording.name } : {}),
      mapa: {
        started_at: recording.startedAt.toISOString(),
        stopped_at: stoppedAt.toISOString(),
        stopped_by: reason,
        limits,
      },
    };
    const saving = writeRecording(options.projectRoot, buildAppMap(metadata, recording.events), recording.startedAt, recording.name);
    stopping = saving;
    try {
      const saved = await saving;
      log(`Gravação salva em ${saved.directory}`);
      return saved;
    } finally {
      stopping = undefined;
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

    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (url.pathname !== "/record") return sendJson(res, 404, { error: "not found" });

    switch (req.method) {
      case "GET":
        return sendJson(res, 200, status());
      case "POST": {
        const body = await readJson(req);
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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 64 * 1024;

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
