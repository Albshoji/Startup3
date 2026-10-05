# Decisões e motivos

Formato: data · decisão · motivo · fonte (quando inspirada numa referência).

## Pendências (aguardando o dono do projeto)

- **[JURÍDICO] Formato AppMap em produto pago.** Antes do lançamento comercial, confirmar com advogado se seguir o formato AppMap (especificação em `referencias/appmap/README.md`) é compatível com a licença. O código do AppMap **não** é usado (CLAUDE.md §2.2).

## Etapa 0

- **2026-10-05 · Licenças verificadas.** `appmap-node`: MIT + Commons Clause. `appmap-js`: `validate`, `client`, `telemetry` = MIT; `models`, `sequence-diagram`, `diagrams`, `components`, `cli`, `scanner`, `navie`, `openapi`, `rpc`, `search` = MIT + Commons Clause. LocatorJS: MIT. babel-plugin-istanbul: BSD-3-Clause. Consequência: nenhum código do AppMap é copiado nem usado como dependência no produto.
- **2026-10-05 · `referencias/` fora do Git** (`.gitignore`), junto com `.env*`, `.mapa/`, `node_modules/`, `.next/`.
- **2026-10-05 · Encaixe pelo `withMapa` + loader Babel**, não por interceptação de `loadConfig` como o `appmap-node`. Motivo: estável entre versões do Next e já validado pelo LocatorJS no Next 16. Fonte: `appmap-node/src/hooks/next.ts`, `locatorjs/packages/webpack-loader/src/index.ts`.
- **2026-10-05 · Babel mantendo TypeScript** (só sintaxe `typescript`+`jsx` no parser, sem preset que remova tipos). Motivo: o `appmap-node` perde arquivos com `enum`/`namespace` no Turbopack por usar `ts-blank-space` + meriyah. Fonte: `appmap-node/src/webpack.ts`. **[Confirmar na Parte B]**
- **2026-10-05 · `parent_id` explícito no `call` e `timestamp` sempre.** Motivo: duas fontes concorrentes (navegador e servidor) e falta de `AsyncLocalStorage` no navegador. O arquivo continua reconstruível pela ordem, como no formato base. Fonte: `appmap-node/src/Recording.ts`, `appmap-js/packages/models/src/appMapBuilder/eventStack.js`.
- **2026-10-05 · Valores encurtados (~100 caracteres) e mascarados na captura.** O `appmap-node` não encurta (usa `util.inspect` com `depth: 1`); a especificação recomenda 100. Fonte: `appmap-node/src/parameter.ts`, `appmap/README.md`.
- **2026-10-05 · Query string e corpo dos pedidos vão em `message`**, como manda a especificação para `http_client_request` (o agente Node não faz isso). Essencial para traduzir PostgREST.
- **2026-10-05 · Pedidos ao Supabase ficam como `http_client_request` + extensão `supabase`**, sem gravar `sql_query` falso. A forma SQL é derivada nos diagramas (tratada como `Query`, nodeType 6).
- **2026-10-05 · Raias do Supabase por serviço** (API, Login, Arquivos, Funções, Tempo real, Banco), em vez de um `external-service` por host como no AppMap. Fonte: `appmap-js/packages/models/src/codeObject.js: constructDataChainFromEvent`.
- **2026-10-05 · Eventos sintéticos do Supabase (gatilhos, cascatas, RLS) numa cópia derivada** (`recording.enriched.appmap.json`), já que `eventUpdates` só substitui eventos existentes. O arquivo bruto original não muda.
- **2026-10-05 · Sequência começa recolhida na profundidade 1** (AppMap: 3). Motivo: público leigo. Fonte: `appmap-js/packages/components/src/components/DiagramSequence.vue`.
- **2026-10-05 · Config em JSON** (`.mapa/config.json`) com a mesma semântica do `appmap.yml`. Fonte: `appmap-node/src/config.ts`, `src/PackageMatcher.ts`.

## Etapa 0, Parte B (riscos 1, 2 e 4)

- **2026-10-05 · Protótipo descartável em `spikes/etapa0/`.** Serve só de evidência; o código do produto será escrito do zero nas Etapas 1–4. Gravações grandes (`*.appmap.json*`) ficam fora do Git.
- **2026-10-05 · Turbopack: duas regras** (`browser` / `not browser`, ambas `not foreign`) em `*.{js,jsx,ts,tsx,mjs,cjs}`; **webpack: `enforce: "pre"`** para receber o código original. Evidência: `docs/spike-report.md`, risco 1.
- **2026-10-05 · Server actions sem `this`/`arguments`:** envoltório com `...args` em código `"use server"` (o Next recusa compilar de outro jeito).
- **2026-10-05 · Marcação de `await` também em `node_modules/@supabase/`** (só marcação, sem gravar funções), via condição `path` do Turbopack; inferência pela "função suspensa mais recente da mesma ação" como reserva. Motivo: `fetchWithAuth` do `supabase-js` faz `await` antes do `fetch`.
- **2026-10-05 · Callbacks de hooks do React (`useEffect`, `useCallback`, `useMemo`…) são instrumentados**, com nome `Componente.hook@linha`. Motivo: sem isso o padrão `useEffect + supabase.then` fica órfão.
- **2026-10-05 · Ações do usuário:** `click`, `submit`, `type` (agrupado por campo, intervalo < 1 s), `navigate` (carga, `pushState`, `popstate`). Re-renderizações sem pai vão para a ação aberta mais recente, como "inferidas".
- **2026-10-05 · Um identificador por carga de página/aba**, usado como trace-id do `traceparent` e para não misturar ids entre recargas.
- **2026-10-05 · Resumo de valores sem efeitos colaterais:** nunca acessar thenables nem getters (o Next 16 acusa erro ao ler `params` de forma síncrona).
- **2026-10-05 · Limites propostos (aguardando aprovação):** 2 min; teto de 50 chamadas por função dentro de cada ação (o resto só é contado); 50 000 eventos; 12 MB de JSON. Ver `docs/spike-report.md`, risco 4.

### Pendências novas
- **Teto por função × critério da Etapa 4** ("o botão do loop para a gravação pelo limite"): com o teto, o loop de uma função só não atinge o limite. Aguardando decisão (o dono definiu o tempo, mas não respondeu sobre o teto).
- **Babel 8 (Node ≥ 22.18) ou Babel 7 (Node 22 mais antigo):** decidir na Etapa 2.

## Etapa 0, Parte B (riscos 3, 5 e 6)

- **2026-10-05 · Projeto de teste montado com autorização do dono** ("autorizo escrever no projeto de teste Startup3 nesta sessão"): migração `examples/next16-supabase-demo/supabase/migrations/20261005000001_schema_inicial.sql` aplicada pelo endpoint de migrações da Management API; Edge Function `send-welcome` publicada pelo endpoint de deploy. A mudança da configuração de autenticação (desligar confirmação de e-mail) foi **barrada** pelo controle de permissões e ficou com o dono.
- **2026-10-05 · Registros: coluna `source`, não `source_name`.** O changelog do Supabase cita `source_name`, mas a API real recusa esse campo. CLAUDE.md §7.6 corrigido com aprovação do dono.
- **2026-10-05 · Ligação com os registros:** no servidor, exata por `sb-request-id`; no navegador, por horário + método + caminho + status (o CORS não expõe `sb-request-id`). `console.log` de Edge Functions por `execution_id`.
- **2026-10-05 · Busca dos registros com fila e espera** (a API devolve `Too Many Requests` com consultas seguidas; a cada 15 s não recusou).
- **2026-10-05 · Permissões da API lidas por `pg_class.relacl`** (o `information_schema` volta vazio no endpoint só de leitura).
- **2026-10-05 · Papel e id do usuário só de `role`/`sub` do JWT**; chaves novas `sb_publishable_` não são JWT (papel "opaque-key").
- **2026-10-05 · Máscara de corpos, parâmetros e query string** (senha, token, segredo, cartão, CPF, e-mail, JWT), aplicada antes de resumir. Testada no cadastro real: nenhuma senha, e-mail, token ou chave nas gravações.
- **2026-10-05 · Projeto de teste com "Confirm email" desligado** (feito pelo dono no painel), para os cenários com login. O cenário "e-mail de confirmação enviado" fica para quando a confirmação for religada.

## Decisões do dono (2026-10-05)

- **Tempo máximo de gravação: 1 minuto** (o CLAUDE.md §9.1 falava em 2 minutos como "padrão inicial"; a sessão realista medida coube com folga em 2 min, então 1 min dá ainda mais margem). Demais limites seguem a proposta: 50 chamadas por função por ação, 50 000 eventos, 12 MB.
- **`@appland/appmap-validate` autorizado como dependência de desenvolvimento, só nos testes** (licença MIT, `referencias/appmap-js/packages/validate/LICENSE`). O produto continua com validador próprio.
- **CLAUDE.md §7.6 corrigido** (`source_name` → `source`, mais o aviso de limite de requisições da API de registros).
