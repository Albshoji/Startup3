// Processing of a received recording (CLAUDE.md §10.2 step 1 and Etapa 7), in two phases:
//   "app":  validate → prune if large (AppMap method) → cross with the database structure saved with
//           the recording → derived file `recording.enriched.appmap.json.gz` → status "pronta";
//   "logs": Supabase's logs (they take minutes to appear) as `eventUpdates` on the derived file,
//           with retries → status "pronta_com_registros".
// The raw file is never changed. Jobs live in `processing_jobs` and are run by `processDueJobs`
// (right after an upload, when a recording page is opened, and by the worker route).
import { gunzipSync, gzipSync } from "node:zlib";
import { pruneAppMap, validateRecording, type AppMap, type CallEvent, type Event } from "@mapa/format";
import { enrichWithSchema, fetchLogs, matchLogs, type SchemaSnapshot } from "@mapa/supabase";
import { managementClientFor } from "@/lib/supabase-oauth";
import { RECORDINGS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

export const ENRICHED_FILE = "recording.enriched.appmap.json.gz";
/** Logs take up to ~35 s to appear (docs/spike-report.md, risk 6): first look a minute after Stop. */
const LOGS_FIRST_DELAY_S = 60;
const LOGS_MAX_ATTEMPTS = 5;

type Admin = ReturnType<typeof supabaseAdmin>;

interface Job {
  id: string;
  recording_id: string;
  phase: "app" | "logs";
  attempts: number;
}

interface RecordingRow {
  id: string;
  project_id: string;
  storage_prefix: string;
  started_at: string | null;
  stopped_at: string | null;
  has_supabase_schema: boolean;
  summary: Record<string, unknown>;
}

export async function enqueue(admin: Admin, recordingId: string, phase: Job["phase"], runAfter = new Date()) {
  await admin
    .from("processing_jobs")
    .upsert({ recording_id: recordingId, phase, status: "pendente", run_after: runAfter.toISOString(), attempts: 0, last_error: null }, { onConflict: "recording_id,phase" });
}

async function download(admin: Admin, path: string): Promise<Buffer | null> {
  const { data } = await admin.storage.from(RECORDINGS_BUCKET).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

async function upload(admin: Admin, path: string, body: Buffer, contentType: string) {
  const { error } = await admin.storage.from(RECORDINGS_BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`não consegui guardar ${path}: ${error.message}`);
}

const supabaseRequests = (events: Event[]) => events.filter((e): e is CallEvent => e.event === "call" && !!e.supabase && !!e.http_client_request);

/** Phase "app". Throws on an unusable file (the recording goes to "erro"). */
async function appPhase(admin: Admin, recording: RecordingRow) {
  await admin.from("recordings").update({ status: "processando", processing_error: null }).eq("id", recording.id);
  const raw = await download(admin, `${recording.storage_prefix}recording.appmap.json.gz`);
  if (!raw) throw new Error("o arquivo bruto não está no armazenamento");
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(raw).toString("utf8"));
  } catch {
    throw new Error("o arquivo bruto não é um JSON comprimido válido");
  }
  const validation = validateRecording(parsed);
  if (validation.errors.length) throw new Error(`arquivo fora do formato: ${validation.errors.slice(0, 3).join("; ")}`);

  const { appmap: pruned, pruned: prunedFunctions } = pruneAppMap(parsed as AppMap);
  let schema: SchemaSnapshot | null = null;
  if (recording.has_supabase_schema) {
    const file = await download(admin, `${recording.storage_prefix}supabase-schema.json`);
    schema = file ? (JSON.parse(file.toString("utf8")) as SchemaSnapshot) : null;
  }
  const enriched = schema ? enrichWithSchema(pruned, schema) : { appmap: pruned, findings: 0, steps: 0 };
  const findingKinds: Record<string, number> = {};
  for (const call of supabaseRequests(enriched.appmap.events)) for (const f of call.supabase?.findings ?? []) findingKinds[f.kind] = (findingKinds[f.kind] ?? 0) + 1;
  const requests = supabaseRequests(enriched.appmap.events).filter((c) => c.supabase!.service !== "realtime").length;

  await upload(admin, recording.storage_prefix + ENRICHED_FILE, gzipSync(JSON.stringify(enriched.appmap)), "application/gzip");
  const summary = {
    events: enriched.appmap.events.length,
    warnings: validation.warnings.length,
    pruned: prunedFunctions,
    supabase_requests: requests,
    schema: !!schema,
    findings: findingKinds,
    database_steps: enriched.steps,
  };
  await admin.from("recordings").update({ status: "pronta", summary, processed_at: new Date().toISOString() }).eq("id", recording.id);

  // Phase "logs" only when there were requests to Supabase and the project is connected to the same Supabase project.
  const { data: connection } = await admin.from("supabase_connections").select("supabase_ref").eq("project_id", recording.project_id).maybeSingle();
  if (requests > 0 && connection?.supabase_ref && schema?.project_ref === connection.supabase_ref) {
    const stoppedAt = recording.stopped_at ? Date.parse(recording.stopped_at) : Date.now();
    await enqueue(admin, recording.id, "logs", new Date(Math.max(Date.now(), stoppedAt + LOGS_FIRST_DELAY_S * 1000)));
  }
}

class RetryLater extends Error {}

/** Phase "logs". Throws RetryLater while not every request found its log line yet. */
async function logsPhase(admin: Admin, recording: RecordingRow, attempt: number) {
  const { data: connection } = await admin.from("supabase_connections").select("supabase_ref").eq("project_id", recording.project_id).maybeSingle();
  if (!connection?.supabase_ref) return; // disconnected meanwhile: stays "pronta"
  const file = await download(admin, recording.storage_prefix + ENRICHED_FILE);
  if (!file) throw new Error("o arquivo processado não está no armazenamento");
  const appmap = JSON.parse(gunzipSync(file).toString("utf8")) as AppMap;

  const times = appmap.events.map((e) => e.timestamp).filter((t): t is number => typeof t === "number");
  const from = (recording.started_at ? Date.parse(recording.started_at) / 1000 : Math.min(...times)) - 60;
  const to = (recording.stopped_at ? Date.parse(recording.stopped_at) / 1000 : Math.max(...times)) + 120;
  const rows = await fetchLogs(managementClientFor(recording.project_id), connection.supabase_ref, from, to);
  const { updates, matched, requests } = matchLogs(appmap, rows);
  const consoleLines = Object.values(updates).reduce((n, e) => n + ((e as CallEvent).supabase?.logs?.console?.length ?? 0), 0);

  await upload(admin, recording.storage_prefix + ENRICHED_FILE, gzipSync(JSON.stringify({ ...appmap, eventUpdates: updates })), "application/gzip");
  const complete = matched >= requests || attempt >= LOGS_MAX_ATTEMPTS;
  await admin
    .from("recordings")
    .update({
      summary: { ...recording.summary, logs: { matched, requests, console_lines: consoleLines, complete: matched >= requests } },
      logs_checked_at: new Date().toISOString(),
      ...(complete ? { status: "pronta_com_registros" } : {}),
    })
    .eq("id", recording.id);
  if (!complete) throw new RetryLater(`${matched} de ${requests} pedidos com registro`);
}

async function runJob(admin: Admin, job: Job) {
  const { data: recording } = await admin
    .from("recordings")
    .select("id, project_id, storage_prefix, started_at, stopped_at, has_supabase_schema, summary")
    .eq("id", job.recording_id)
    .maybeSingle();
  if (!recording) {
    await admin.from("processing_jobs").update({ status: "feito" }).eq("id", job.id);
    return;
  }
  try {
    if (job.phase === "app") await appPhase(admin, recording as RecordingRow);
    else await logsPhase(admin, recording as RecordingRow, job.attempts);
    await admin.from("processing_jobs").update({ status: "feito", last_error: null }).eq("id", job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job.phase === "logs" && job.attempts < LOGS_MAX_ATTEMPTS) {
      // Logs show up late or the API is busy: look again later (1, 2, 3… minutes).
      await admin.from("processing_jobs").update({ status: "pendente", last_error: message, run_after: new Date(Date.now() + 60_000 * job.attempts).toISOString() }).eq("id", job.id);
      return;
    }
    await admin.from("processing_jobs").update({ status: "erro", last_error: message }).eq("id", job.id);
    if (job.phase === "app") await admin.from("recordings").update({ status: "erro", processing_error: message }).eq("id", recording.id);
  }
}

/** Runs the jobs that are due now. Safe to call from several places at once. */
export async function processDueJobs(maxJobs = 3): Promise<number> {
  const admin = supabaseAdmin();
  const { data: jobs, error } = await admin.rpc("claim_processing_jobs", { max_jobs: maxJobs });
  if (error || !jobs?.length) return 0;
  for (const job of jobs as Job[]) await runJob(admin, job);
  return jobs.length;
}
