import Link from "next/link";
import { redirect } from "next/navigation";
import { STATUS_LABELS } from "@/lib/recordings";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Gravacoes() {
  const user = await currentUser();
  if (!user) redirect("/entrar?depois=/gravacoes");
  const supabase = await supabaseForUser();
  // RLS: only this person's recordings come back.
  const { data: recordings, error } = await supabase
    .from("recordings")
    .select("id, name, status, created_at, event_count, gzip_bytes, stopped_by, projects(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <h1>Suas gravações</h1>
      {error && <p className="alert error">Não consegui carregar as gravações.</p>}
      {!recordings?.length ? (
        <div className="card">
          <p>Você ainda não enviou nenhuma gravação. No terminal, dentro da pasta do seu app:</p>
          <pre>{`npx mapa login     # conecta este computador à sua conta (uma vez)
npx mapa dev       # liga o app com o Mapa
# grave pelo botão do Mapa no app; no Stop a gravação chega aqui`}</pre>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Projeto</th>
                <th className="hide-mobile">Eventos</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/gravacoes/${r.id}`}>{new Date(r.created_at).toLocaleString("pt-BR")}</Link>
                    {r.name && <div className="muted">{r.name}</div>}
                  </td>
                  <td>{(r.projects as unknown as { name: string } | null)?.name}</td>
                  <td className="hide-mobile">{r.event_count ?? "—"}</td>
                  <td>
                    <span className={`badge ${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
