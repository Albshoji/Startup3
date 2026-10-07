import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Projetos() {
  const user = await currentUser();
  if (!user) redirect("/entrar?depois=/projetos");
  const supabase = await supabaseForUser();
  const { data: projects } = await supabase.from("projects").select("id, name, created_at, supabase_connections(supabase_project_name)").order("name");
  return (
    <>
      <h1>Seus projetos</h1>
      {!projects?.length ? (
        <div className="card">
          <p>Os projetos aparecem aqui quando você envia a primeira gravação de um app (<code>npx mapa login</code> e depois grave pelo botão do Mapa).</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Supabase</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const connection = (p.supabase_connections as unknown as { supabase_project_name: string | null }[] | { supabase_project_name: string | null } | null) ?? null;
                const name = Array.isArray(connection) ? connection[0]?.supabase_project_name : connection?.supabase_project_name;
                const connected = Array.isArray(connection) ? connection.length > 0 : !!connection;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projetos/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{connected ? <span className="badge recebida">conectado{name ? `: ${name}` : ""}</span> : <span className="muted">não conectado</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
