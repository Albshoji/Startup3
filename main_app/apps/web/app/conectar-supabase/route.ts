import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, newPkce, sha256, STATE_TTL_SECONDS } from "@/lib/supabase-oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";

/** "Conectar Supabase": sends the person to Supabase to authorize Mapa (read-only) for a Mapa project. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projeto") ?? "";
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL(`/entrar?depois=${encodeURIComponent(`/projetos/${projectId}`)}`, request.url));
  // RLS: only a project of this person is found.
  const { data: project } = await (await supabaseForUser()).from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return new NextResponse("Projeto não encontrado.", { status: 404 });

  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = newPkce();
  const { error } = await supabaseAdmin()
    .from("supabase_oauth_states")
    .insert({ state_hash: sha256(state), user_id: user.id, project_id: project.id, code_verifier: verifier, expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString() });
  if (error) return new NextResponse("Não consegui iniciar a conexão. Tente de novo.", { status: 500 });
  return NextResponse.redirect(authorizeUrl(url.origin, state, challenge));
}
