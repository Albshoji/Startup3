import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { STATUS_LABELS, STOP_LABELS } from "@/lib/recordings";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function size(bytes: number | null) {
  if (bytes === null) return "—";
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1000).toFixed(1)} KB`;
}

export default async function Gravacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/entrar?depois=/gravacoes/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseForUser();
  // RLS: someone else's recording is simply not found.
  const { data: r } = await supabase.from("recordings").select("*, projects(id, name, supabase_connections(supabase_ref))").eq("id", id).maybeSingle();
  if (!r) notFound();
  const project = r.projects as unknown as { id: string; name: string; supabase_connections: { supabase_ref: string | null }[] | { supabase_ref: string | null } | null } | null;
  const connection = Array.isArray(project?.supabase_connections) ? project.supabase_connections[0] : project?.supabase_connections;
  const meta = r.metadata as { app?: string; frameworks?: { name: string; version: string }[]; git?: { branch?: string; commit?: string }; incomplete_calls?: number };

  return (
    <>
      <p>
        <Link href="/gravacoes">← Gravações</Link>
      </p>
      <h1>{r.name || `Gravação de ${new Date(r.created_at).toLocaleString("pt-BR")}`}</h1>
      <div className="card">
        <p>
          <span className={`badge ${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
        </p>
        {r.status === "recebida" && (
          <p className="muted">
            O arquivo chegou inteiro. Os diagramas e as explicações em português simples aparecem aqui quando o processamento estiver
            pronto (próximas etapas do Mapa).
          </p>
        )}
        {r.status === "enviando" && <p className="muted">O envio começou mas ainda não terminou. Se ficar assim, rode <code>npx mapa upload</code> de novo.</p>}
        <dl>
          <dt>Projeto</dt>
          <dd>{project ? <Link href={`/projetos/${project.id}`}>{project.name}</Link> : "—"}</dd>
          <dt>Supabase</dt>
          <dd id="supabase-retrato">
            {r.has_supabase_schema ? (
              "Retrato da estrutura do banco guardado com esta gravação."
            ) : connection?.supabase_ref ? (
              "Conectado, mas esta gravação não tem retrato da estrutura."
            ) : (
              <>
                Não conectado: sem isso não dá para explicar regras de acesso, gatilhos e o que acontece dentro do Supabase.{" "}
                {project && <Link href={`/projetos/${project.id}`}>Conectar Supabase</Link>}
              </>
            )}
          </dd>
          <dt>Gravada</dt>
          <dd>
            {r.started_at ? new Date(r.started_at).toLocaleString("pt-BR") : "—"}
            {r.stopped_at && r.started_at ? ` (${Math.round((Date.parse(r.stopped_at) - Date.parse(r.started_at)) / 1000)} s, ${STOP_LABELS[r.stopped_by] ?? r.stopped_by})` : ""}
          </dd>
          <dt>Eventos</dt>
          <dd>{r.event_count ?? "—"}</dd>
          <dt>Tamanho</dt>
          <dd>
            {size(r.size_bytes)} ({size(r.gzip_bytes)} comprimido)
          </dd>
          {meta.frameworks?.length ? (
            <>
              <dt>Tecnologias</dt>
              <dd>{meta.frameworks.map((f) => `${f.name} ${f.version}`).join(", ")}</dd>
            </>
          ) : null}
          {meta.git?.branch ? (
            <>
              <dt>Git</dt>
              <dd>
                {meta.git.branch} {meta.git.commit ? <code>{meta.git.commit.slice(0, 7)}</code> : null}
              </dd>
            </>
          ) : null}
        </dl>
        {r.status !== "enviando" && (
          <div className="row">
            <a className="button" href={`/gravacoes/${r.id}/baixar`}>
              Baixar arquivo bruto
            </a>
          </div>
        )}
      </div>
    </>
  );
}
