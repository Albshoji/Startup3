import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SchemaSnapshot, SupabaseProjectSummary } from "@mapa/supabase";
import SchemaView from "@/components/SchemaView";
import { STATUS_LABELS } from "@/lib/recordings";
import { managementClientFor } from "@/lib/supabase-oauth";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";
import { desconectarSupabase, escolherProjetoSupabase, lerEstruturaDeNovo } from "./actions";

export const dynamic = "force-dynamic";

export default async function Projeto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aviso?: string }> }) {
  const { id } = await params;
  const { aviso } = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/entrar?depois=/projetos/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseForUser();
  // RLS: someone else's project is not found.
  const { data: project } = await supabase.from("projects").select("id, name, supabase_ref_hint").eq("id", id).maybeSingle();
  if (!project) notFound();
  const { data: connection } = await supabase
    .from("supabase_connections")
    .select("supabase_ref, supabase_project_name, schema_snapshot, schema_read_at, connected_at")
    .eq("project_id", id)
    .maybeSingle();
  const { data: recordings } = await supabase.from("recordings").select("id, name, status, created_at, event_count").eq("project_id", id).order("created_at", { ascending: false }).limit(20);

  let choices: SupabaseProjectSummary[] = [];
  let choicesError: string | undefined;
  if (connection && !connection.supabase_ref) {
    try {
      choices = await managementClientFor(id).listProjects();
    } catch (error) {
      choicesError = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <>
      <p>
        <Link href="/projetos">← Projetos</Link>
      </p>
      <h1>{project.name}</h1>
      {aviso && <p className="alert ok">{aviso}</p>}

      <div className="card" id="supabase">
        <h2>Supabase</h2>
        {!connection ? (
          <>
            <p>
              Conecte o Supabase deste app para o Mapa enxergar o que acontece <strong>dentro</strong> do Supabase: regras de acesso (RLS),
              gatilhos, funções do banco, arquivos e Edge Functions. Sem isso, as gravações mostram só o que o app pediu e o que voltou.
            </p>
            <p className="muted">
              O acesso é <strong>só de leitura</strong>: o Mapa nunca altera nada no seu Supabase. Recomendamos conectar o projeto de{" "}
              <strong>desenvolvimento</strong>. Você pode desconectar quando quiser.
            </p>
            <div className="row">
              <a id="conectar-supabase" className="button" href={`/conectar-supabase?projeto=${project.id}`}>
                Conectar Supabase
              </a>
            </div>
          </>
        ) : !connection.supabase_ref ? (
          <>
            <p>Conectado. Qual projeto do Supabase este app usa?</p>
            {choicesError && <p className="alert error">Não consegui listar os projetos: {choicesError}</p>}
            <form action={escolherProjetoSupabase}>
              <input type="hidden" name="projeto" value={project.id} />
              {choices.map((p) => (
                <label key={p.ref} style={{ fontWeight: 400 }}>
                  <input type="radio" name="ref" value={p.ref} defaultChecked={p.ref === project.supabase_ref_hint} style={{ width: "auto", marginRight: 8 }} />
                  {p.name} <span className="muted">({p.ref}){p.ref === project.supabase_ref_hint ? " — é o que o seu app usa" : ""}</span>
                </label>
              ))}
              <div className="row">
                <button type="submit">Usar este projeto</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p>
              Conectado ao projeto <strong id="supabase-projeto">{connection.supabase_project_name}</strong> <span className="muted">({connection.supabase_ref})</span>
              {project.supabase_ref_hint && project.supabase_ref_hint !== connection.supabase_ref && (
                <span className="alert error" style={{ display: "block", marginTop: 8 }}>
                  Atenção: as gravações deste app falam com outro projeto do Supabase ({project.supabase_ref_hint}).
                </span>
              )}
            </p>
            <div className="row">
              <form action={lerEstruturaDeNovo}>
                <input type="hidden" name="projeto" value={project.id} />
                <button className="secondary" type="submit">
                  Ler a estrutura de novo
                </button>
              </form>
              <form action={desconectarSupabase}>
                <input type="hidden" name="projeto" value={project.id} />
                <button id="desconectar-supabase" className="secondary" type="submit">
                  Desconectar
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {connection?.schema_snapshot ? (
        <div className="card">
          <h2>Estrutura do banco</h2>
          <SchemaView schema={connection.schema_snapshot as SchemaSnapshot} />
        </div>
      ) : null}

      <div className="card">
        <h2>Gravações</h2>
        {!recordings?.length ? (
          <p className="muted">Nenhuma gravação ainda.</p>
        ) : (
          <ul>
            {recordings.map((r) => (
              <li key={r.id}>
                <Link href={`/gravacoes/${r.id}`}>{r.name || new Date(r.created_at).toLocaleString("pt-BR")}</Link> · {r.event_count ?? "?"} eventos ·{" "}
                <span className={`badge ${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
