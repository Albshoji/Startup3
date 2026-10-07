import { authenticateCli, cliError, siteOrigin } from "@/lib/cli-auth";
import { MAX_UPLOAD_BYTES, RECORDING_FILES, summarizeMetadata, type RecordingFile } from "@/lib/recordings";
import { RECORDINGS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

interface CreateBody {
  project?: { name?: unknown; supabase_ref?: unknown };
  recording?: {
    name?: unknown;
    started_at?: unknown;
    stopped_at?: unknown;
    stopped_by?: unknown;
    event_count?: unknown;
    size_bytes?: unknown;
    gzip_bytes?: unknown;
    metadata?: unknown;
  };
}

const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/**
 * Starts an upload: creates the project (by name) and the recording ("enviando"), and returns
 * signed upload URLs for its files in the private bucket. The CLI then PUTs the files and calls
 * /complete.
 */
export async function POST(request: Request) {
  const caller = await authenticateCli(request);
  if (!caller) return cliError(401, "unauthorized", "Este computador não está conectado. Rode `npx mapa login`.");
  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const projectName = typeof body.project?.name === "string" ? body.project.name.trim().slice(0, 200) : "";
  if (!projectName) return cliError(400, "invalid_request", "Falta o nome do projeto.");
  const rec = body.recording ?? {};
  const gzipBytes = count(rec.gzip_bytes);
  if (gzipBytes !== null && gzipBytes > MAX_UPLOAD_BYTES) return cliError(413, "too_large", "A gravação passa do tamanho máximo de envio (50 MB).");

  const admin = supabaseAdmin();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .upsert(
      {
        owner_id: caller.userId,
        name: projectName,
        ...(typeof body.project?.supabase_ref === "string" && /^[a-z0-9]{6,40}$/.test(body.project.supabase_ref) ? { supabase_ref_hint: body.project.supabase_ref } : {}),
      },
      { onConflict: "owner_id,name" },
    )
    .select("id")
    .single();
  if (projectError || !project) return cliError(500, "server_error", "Não consegui registrar o projeto.");

  const id = crypto.randomUUID();
  const prefix = `${caller.userId}/${id}/`;
  const { error } = await admin.from("recordings").insert({
    id,
    owner_id: caller.userId,
    project_id: project.id,
    name: typeof rec.name === "string" ? rec.name.slice(0, 200) : null,
    started_at: date(rec.started_at),
    stopped_at: date(rec.stopped_at),
    stopped_by: typeof rec.stopped_by === "string" ? rec.stopped_by.slice(0, 30) : null,
    event_count: count(rec.event_count),
    size_bytes: count(rec.size_bytes),
    gzip_bytes: gzipBytes,
    storage_prefix: prefix,
    metadata: summarizeMetadata(rec.metadata),
  });
  if (error) return cliError(500, "server_error", "Não consegui registrar a gravação.");

  const uploads = [];
  for (const [file, contentType] of Object.entries(RECORDING_FILES) as [RecordingFile, string][]) {
    const { data, error: signError } = await admin.storage.from(RECORDINGS_BUCKET).createSignedUploadUrl(prefix + file);
    if (signError || !data) return cliError(500, "server_error", "Não consegui preparar o envio dos arquivos.");
    uploads.push({ file, url: data.signedUrl, content_type: contentType });
  }
  return Response.json({ id, url: `${siteOrigin(request)}/gravacoes/${id}`, uploads });
}
