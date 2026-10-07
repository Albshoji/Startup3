import Link from "next/link";
import { gunzipSync } from "node:zlib";
import { after } from "next/server";
import type { AppMap } from "@mapa/format";
import SupabaseFindings from "@/components/SupabaseFindings";
import { ENRICHED_FILE, processDueJobs } from "@/lib/processing";
import { RECORDINGS_BUCKET } from "@/lib/supabase/admin";
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
  // Opening the page also moves the processing queue along (in the background).
  if (r.status !== "pronta_com_registros" && r.status !== "erro") after(() => processDueJobs().catch(() => {}));
  let enriched: AppMap | null = null;
  if (r.status === "pronta" || r.status === "pronta_com_registros") {
    const { data: file } = await supabase.storage.from(RECORDINGS_BUCKET).download(`${r.storage_prefix}${ENRICHED_FILE}`);
    if (file) enriched = JSON.parse(gunzipSync(Buffer.from(await file.arrayBuffer())).toString("utf8")) as AppMap;
  }
  const summary = r.summary as { pruned?: { function: string; removed_calls: number }[]; logs?: { matched: number; requests: number; complete: boolean } };
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
        {r.status === "processando" && <p className="muted">Processando: conferindo o arquivo e cruzando com a estrutura do seu Supabase. Recarregue em alguns segundos.</p>}
        {r.status === "pronta" && (
          <p className="muted">
            Pronta.{" "}
            {connection?.supabase_ref
              ? "Os registros do Supabase chegam alguns minutos depois da gravação; quando chegarem, esta página mostra também o que eles confirmam."
              : ""}
          </p>
        )}
        {r.status === "pronta_com_registros" && summary.logs && (
          <p className="muted">
            Pronta, com os registros do Supabase: {summary.logs.matched} de {summary.logs.requests} pedidos encontrados nos registros.
          </p>
        )}
        {r.status === "erro" && <p className="alert error">Não foi possível processar esta gravação: {r.processing_error}</p>}
        {summary.pruned?.length ? (
          <p className="alert">
            A gravação era grande e foi cortada: ficaram de fora as chamadas de {summary.pruned.map((p) => `${p.function} (${p.removed_calls})`).join(", ")}.
          </p>
        ) : null}
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
        {enriched && (
          <>
            <h2 style={{ marginTop: 24 }}>O que aconteceu no Supabase</h2>
            <SupabaseFindings appmap={enriched} />
          </>
        )}
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
