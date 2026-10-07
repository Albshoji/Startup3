import type { AppMap, CallEvent, PolicyRef, SupabaseFinding } from "@mapa/format";

// What Mapa found out about each request to Supabase, in plain Portuguese, with the certainty
// (CLAUDE.md §7.3): from the recording, from Supabase's logs, or configured in the database.
// (The LLM wording of Etapa 9 will replace these fixed sentences; the facts stay the same.)

const CERTAINTY: Record<string, string> = {
  recorded: "confirmado pela gravação",
  logs: "confirmado pelos registros do Supabase",
  schema: "configurado no banco",
};

const OPERATION: Record<string, string> = {
  select: "ler linhas de",
  count: "contar linhas de",
  insert: "criar linha em",
  upsert: "criar ou alterar linha em",
  update: "alterar linhas de",
  delete: "apagar linhas de",
  rpc: "chamar a função do banco",
  signup: "cadastrar um usuário",
  login: "fazer login",
  logout: "sair",
  get_user: "consultar o usuário logado",
  upload: "enviar arquivo para",
  download: "baixar arquivo de",
  invoke: "chamar a Edge Function",
};

const who = (role?: string) => (role === "anon" ? "quem não está logado" : role === "authenticated" ? "um usuário logado" : role ?? "alguém");
const rule = (p: PolicyRef) => `“${p.name}”${p.using ? ` (só enxerga linhas em que ${p.using})` : p.with_check ? ` (só aceita linhas em que ${p.with_check})` : ""}`;

function explain(f: SupabaseFinding): string {
  const rules = (f.policies ?? []).map(rule).join("; ");
  const others = (f.other_policies ?? []).map((p) => `${rule(p)} vale para ${p.roles.join(", ")}`).join("; ");
  switch (f.kind) {
    case "rls_filtered":
      return `Voltou vazio por causa da regra de acesso (RLS) de ${f.table}, não porque a tabela está vazia. ${rules ? `Para ${who(f.role)} vale: ${rules}.` : `Não há regra que deixe ${who(f.role)} ler essa tabela.`}${others ? ` A regra que existe: ${others}.` : ""}`;
    case "rls_denied":
      return `Recusado pela regra de acesso (RLS) de ${f.table}. ${rules ? `Regra: ${rules}.` : `Não há regra que permita isso para ${who(f.role)}.`}${others ? ` A regra que existe: ${others}.` : ""}`;
    case "rls_no_policy":
      return `A tabela ${f.table} tem regra de acesso (RLS) ligada, mas nenhuma regra vale para ${who(f.role)}.`;
    case "rls_off":
      return `Atenção: a tabela ${f.table} está SEM regra de acesso (RLS). Qualquer pessoa com a chave pública do app pode ler e alterar.`;
    case "rls_bypassed":
      return `Pedido com a chave secreta (service_role): as regras de acesso de ${f.table} não se aplicam.`;
    case "policy":
      return `Permitido pela regra de acesso (RLS)${f.bucket ? ` do bucket ${f.bucket}` : ` de ${f.table}`}: ${rules}.`;
    case "trigger":
      return `O banco roda sozinho o gatilho “${f.trigger}” em ${f.table}, que executa ${f.function}.`;
    case "cascade":
      return `Apagar aqui apaga também as linhas ligadas em ${f.table} (exclusão em cascata).`;
    case "function":
      return `Função do banco ${f.function}${f.security === "definer" ? ": roda como o dono da função e ignora as regras de acesso" : ": respeita as regras de acesso de quem chamou"}.`;
    case "bucket":
      return `Bucket ${f.bucket}: ${f.public ? "público (qualquer um baixa pelo link)" : "privado"}.`;
    case "bucket_denied":
      return `Recusado pela regra de acesso dos arquivos do bucket ${f.bucket}.`;
    case "edge_function":
      return `Edge Function ${f.function}${f.verify_jwt === false ? " (aceita chamadas sem login)" : ""}.`;
    case "edge_function_missing":
      return `A Edge Function ${f.function} não existe no projeto conectado.`;
    default:
      return "";
  }
}

export default function SupabaseFindings({ appmap }: { appmap: AppMap }) {
  const updates = (appmap.eventUpdates ?? {}) as Record<string, CallEvent>;
  const requests = appmap.events
    .filter((e): e is CallEvent => e.event === "call" && !!e.supabase && !!e.http_client_request && e.supabase.service !== "realtime")
    .map((e) => (updates[String(e.id)] as CallEvent | undefined) ?? e);
  if (!requests.length) return <p className="muted">Esta gravação não tem pedidos ao Supabase.</p>;
  return (
    <ol id="achados">
      {requests.map((call) => {
        const info = call.supabase!;
        const target = info.table ?? info.function ?? info.bucket ?? "";
        return (
          <li key={call.id} data-evento={call.id} style={{ marginBottom: 12 }}>
            <strong>
              {who(info.role)} pediu para {OPERATION[info.operation] ?? info.operation} {target}
            </strong>{" "}
            <span className="muted">({CERTAINTY.recorded})</span>
            {info.sql && (
              <div>
                <code>{info.sql}</code>
              </div>
            )}
            <ul>
              {(info.findings ?? []).map((f, i) => (
                <li key={i} data-achado={f.kind}>
                  {explain(f)} <span className="muted">({CERTAINTY[f.certainty]})</span>
                </li>
              ))}
              {info.logs && (
                <li data-achado="logs">
                  Apareceu nos registros do Supabase{info.logs.status ? ` com resposta ${info.logs.status}` : ""}. <span className="muted">({CERTAINTY.logs})</span>
                  {info.logs.console?.length ? (
                    <pre data-console>{info.logs.console.map((l) => `console.${l.level ?? "log"}: ${l.message}`).join("\n")}</pre>
                  ) : null}
                  {info.logs.database_errors?.length ? <pre>{info.logs.database_errors.map((l) => `banco: ${l.message}`).join("\n")}</pre> : null}
                </li>
              )}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
