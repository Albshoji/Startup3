import { pgArray, type SchemaSnapshot } from "@mapa/supabase";

/** Structure of the person's database, as read from Supabase ("configurado no banco", CLAUDE.md §7.3). */
export default function SchemaView({ schema }: { schema: SchemaSnapshot }) {
  const publicTables = schema.tables.filter((t) => t.schema === "public");
  const policiesOf = (schemaName: string, table: string) => schema.policies.filter((p) => p.schema === schemaName && p.table === table);
  return (
    <div id="estrutura">
      <p className="muted">
        Lido do seu Supabase em {new Date(schema.read_at).toLocaleString("pt-BR")}. Isto é o que está <strong>configurado no banco</strong>: diz o
        que deveria acontecer; as gravações mostram o que aconteceu de fato.
      </p>
      {schema.errors.length > 0 && (
        <p className="alert error">
          Algumas partes não puderam ser lidas: {schema.errors.map((e) => e.section).join(", ")}. Isso costuma ser falta de permissão no app do
          Mapa no Supabase.
        </p>
      )}

      <h3>Tabelas ({publicTables.length})</h3>
      {publicTables.map((t) => {
        const policies = policiesOf(t.schema, t.name);
        return (
          <details key={t.name} className="card" data-tabela={t.name}>
            <summary>
              <strong>{t.name}</strong>{" "}
              <span className={`badge ${t.rls_enabled ? "recebida" : "erro"}`}>{t.rls_enabled ? `regra de acesso (RLS) ligada · ${policies.length} regra(s)` : "SEM regra de acesso (RLS)"}</span>
            </summary>
            <p className="muted">Colunas: {t.columns.map((c) => `${c.name} (${c.type})`).join(", ")}</p>
            {t.grants.length > 0 && <p className="muted">Quem pode usar pela API: {t.grants.map((g) => `${g.role}: ${g.privileges}`).join(" · ")}</p>}
            {policies.map((p) => (
              <div key={p.name} className="policy">
                <p>
                  <strong>Regra de acesso “{p.name}”</strong> — vale para {p.command === "ALL" ? "todas as operações" : p.command} de {pgArray(p.roles).join(", ")}
                </p>
                {p.using && (
                  <p>
                    Só enxerga as linhas em que: <code>{p.using}</code>
                  </p>
                )}
                {p.with_check && (
                  <p>
                    Só aceita gravar linhas em que: <code>{p.with_check}</code>
                  </p>
                )}
              </div>
            ))}
          </details>
        );
      })}

      <h3>Gatilhos ({schema.triggers.length})</h3>
      <p className="muted">Código que o banco roda sozinho quando algo acontece numa tabela.</p>
      {schema.triggers.map((t) => (
        <details key={`${t.schema}.${t.table}.${t.name}`} className="card" data-gatilho={t.name}>
          <summary>
            <strong>{t.name}</strong> em {t.schema}.{t.table} → roda {t.function}
          </summary>
          <pre>{t.definition}</pre>
          {t.function_code && <pre>{t.function_code.trim()}</pre>}
        </details>
      ))}

      <h3>Funções do banco ({schema.functions.length})</h3>
      {schema.functions.map((f) => (
        <details key={f.name} className="card" data-funcao={f.name}>
          <summary>
            <strong>{f.name}</strong>({f.arguments}) → {f.returns}{" "}
            <span className="muted">
              ({f.language}, roda como {f.security === "definer" ? "dono da função (ignora as regras de acesso)" : "quem chamou"})
            </span>
          </summary>
          {f.code && <pre>{f.code.trim()}</pre>}
        </details>
      ))}

      <h3>Ligações entre tabelas ({schema.foreign_keys.length})</h3>
      <ul>
        {schema.foreign_keys.map((k) => (
          <li key={k.name} data-ligacao={k.name}>
            {k.table} → {k.references_schema}.{k.references_table}
            {k.on_delete === "cascade" ? ": apagar o registro ligado apaga também estas linhas (cascata)" : `: ao apagar, ${k.on_delete}`}
          </li>
        ))}
      </ul>

      <h3>Arquivos (buckets) ({schema.buckets.length})</h3>
      <ul>
        {schema.buckets.map((b) => (
          <li key={b.id} data-bucket={b.id}>
            <strong>{b.name}</strong>: {b.public ? "público (qualquer um baixa pelo link)" : "privado"} · {policiesOf("storage", "objects").length} regra(s) de acesso em
            arquivos no projeto
          </li>
        ))}
      </ul>

      <h3>Edge Functions ({schema.edge_functions.length})</h3>
      <ul>
        {schema.edge_functions.map((f) => (
          <li key={f.slug} data-edge-function={f.slug}>
            <strong>{f.name}</strong> {f.status ? <span className="muted">({f.status.toLowerCase()})</span> : null}
            {f.verify_jwt === false ? " · aceita chamadas sem login" : ""}
          </li>
        ))}
      </ul>

      <h3>Tempo real</h3>
      <p>{schema.realtime_tables.length ? `Tabelas que avisam mudanças ao vivo: ${schema.realtime_tables.map((t) => t.table).join(", ")}.` : "Nenhuma tabela com tempo real."}</p>
      {schema.webhooks.length > 0 && (
        <>
          <h3>Webhooks do banco ({schema.webhooks.length})</h3>
          <ul>
            {schema.webhooks.map((w) => (
              <li key={w.name}>
                {w.name} em {w.table}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
