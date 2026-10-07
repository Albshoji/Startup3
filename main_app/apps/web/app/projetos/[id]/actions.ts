"use server";

import { redirect } from "next/navigation";
import { managementClientFor, refreshSchema } from "@/lib/supabase-oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";

/** The project must be the logged-in person's (checked through RLS). */
async function ownProject(projectId: string) {
  const user = await currentUser();
  if (!user) redirect(`/entrar?depois=/projetos/${projectId}`);
  const { data } = await (await supabaseForUser()).from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!data) redirect("/projetos");
  return data.id as string;
}

const back = (projectId: string, message: string): never => redirect(`/projetos/${projectId}?aviso=${encodeURIComponent(message)}`);

export async function escolherProjetoSupabase(form: FormData) {
  const projectId = await ownProject(String(form.get("projeto")));
  const ref = String(form.get("ref") ?? "");
  const projects = await managementClientFor(projectId).listProjects();
  const chosen = projects.find((p) => p.ref === ref);
  if (!chosen) back(projectId, "Esse projeto do Supabase não está entre os autorizados.");
  await supabaseAdmin().from("supabase_connections").update({ supabase_ref: chosen!.ref, supabase_project_name: chosen!.name, supabase_org_id: chosen!.organization_id }).eq("project_id", projectId);
  try {
    await refreshSchema(projectId);
  } catch {
    back(projectId, `Projeto ${chosen!.name} escolhido, mas não consegui ler a estrutura agora.`);
  }
  back(projectId, `Projeto ${chosen!.name} conectado. A estrutura do banco foi lida.`);
}

export async function lerEstruturaDeNovo(form: FormData) {
  const projectId = await ownProject(String(form.get("projeto")));
  try {
    await refreshSchema(projectId);
  } catch (error) {
    back(projectId, error instanceof Error ? error.message : "Não consegui ler a estrutura.");
  }
  back(projectId, "Estrutura lida de novo.");
}

/** "Desconectar": deletes the stored tokens (the snapshots already taken with recordings stay). */
export async function desconectarSupabase(form: FormData) {
  const projectId = await ownProject(String(form.get("projeto")));
  await supabaseAdmin().from("supabase_connections").delete().eq("project_id", projectId);
  back(projectId, "Desconectado. O Mapa apagou o acesso ao seu Supabase. Para remover a autorização também no Supabase: Organization settings → OAuth Apps (autorizados) → Mapa → Revoke.");
}
