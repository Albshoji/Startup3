import { NextResponse } from "next/server";
import { RECORDINGS_BUCKET } from "@/lib/supabase/admin";
import { supabaseForUser } from "@/lib/supabase/server";

/** Download of the raw file, as the logged-in person: RLS on the table and on the bucket apply. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseForUser();
  const { data: r } = await supabase.from("recordings").select("storage_prefix").eq("id", id).maybeSingle();
  if (!r) return new NextResponse("Gravação não encontrada.", { status: 404 });
  const { data } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(`${r.storage_prefix}recording.appmap.json.gz`, 60, { download: true });
  if (!data) return new NextResponse("Arquivo não encontrado.", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 303 });
}
