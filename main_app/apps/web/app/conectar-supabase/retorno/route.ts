import { NextResponse } from "next/server";
import { exchangeCode, managementClientFor, refreshSchema, sha256, storeTokens } from "@/lib/supabase-oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

/** Return from Supabase after the person authorized (or refused) Mapa. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (projectId: string | null, message?: string) =>
    NextResponse.redirect(new URL(`${projectId ? `/projetos/${projectId}` : "/projetos"}${message ? `?aviso=${encodeURIComponent(message)}` : ""}`, request.url));

  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/entrar?depois=/projetos", request.url));
  const state = url.searchParams.get("state") ?? "";
  const admin = supabaseAdmin();
  const { data: saved } = await admin.from("supabase_oauth_states").select("*").eq("state_hash", sha256(state)).maybeSingle();
  // A state is used once, by the same person, within 10 minutes.
  if (saved) await admin.from("supabase_oauth_states").delete().eq("state_hash", saved.state_hash);
  if (!saved || saved.user_id !== user.id || new Date(saved.expires_at).getTime() < Date.now()) {
    return back(null, "O pedido de conexão expirou ou não é desta sessão. Tente conectar de novo.");
  }
  if (url.searchParams.get("error")) return back(saved.project_id, "A conexão com o Supabase foi cancelada.");
  const code = url.searchParams.get("code");
  if (!code) return back(saved.project_id, "O Supabase não devolveu a autorização. Tente de novo.");

  try {
    await storeTokens(saved.project_id, user.id, await exchangeCode(url.origin, code, saved.code_verifier));
  } catch {
    return back(saved.project_id, "Não consegui concluir a conexão com o Supabase. Tente de novo.");
  }

  // If the project the app uses (detected by the CLI) is among the authorized ones, choose it right away.
  const { data: project } = await admin.from("projects").select("supabase_ref_hint").eq("id", saved.project_id).single();
  try {
    const projects = await managementClientFor(saved.project_id).listProjects();
    const match = projects.find((p) => p.ref === project?.supabase_ref_hint);
    if (match) {
      await admin.from("supabase_connections").update({ supabase_ref: match.ref, supabase_project_name: match.name, supabase_org_id: match.organization_id }).eq("project_id", saved.project_id);
      await refreshSchema(saved.project_id);
      return back(saved.project_id, `Conectado ao projeto ${match.name} do Supabase.`);
    }
  } catch {
    // the person chooses on the project page
  }
  return back(saved.project_id, "Conectado. Agora escolha qual projeto do Supabase este app usa.");
}
