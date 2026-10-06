import { authenticateCli, cliError, siteOrigin } from "@/lib/cli-auth";
import { RECORDING_FILES } from "@/lib/recordings";
import { RECORDINGS_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

/** Ends an upload: checks the files are in the bucket and marks the recording as "recebida". */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authenticateCli(request);
  if (!caller) return cliError(401, "unauthorized", "Este computador não está conectado. Rode `npx mapa login`.");
  const { id } = await params;
  const admin = supabaseAdmin();
  const { data: recording } = await admin.from("recordings").select("id, owner_id, storage_prefix, status").eq("id", id).maybeSingle();
  // Someone else's recording looks exactly like a missing one.
  if (!recording || recording.owner_id !== caller.userId) return cliError(404, "not_found", "Gravação não encontrada.");

  const { data: files } = await admin.storage.from(RECORDINGS_BUCKET).list(recording.storage_prefix.replace(/\/$/, ""));
  const present = new Set((files ?? []).map((f) => f.name));
  const missing = Object.keys(RECORDING_FILES).filter((f) => !present.has(f));
  if (missing.length) return cliError(409, "incomplete_upload", `Faltam arquivos no envio: ${missing.join(", ")}.`);

  if (recording.status === "enviando") {
    await admin.from("recordings").update({ status: "recebida", received_at: new Date().toISOString() }).eq("id", id);
  }
  return Response.json({ id, status: "recebida", url: `${siteOrigin(request)}/gravacoes/${id}` });
}
