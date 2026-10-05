# Decisões e motivos

Formato: data · decisão · motivo · fonte (quando inspirada numa referência).

## Pendências (aguardando o dono do projeto)

- **[JURÍDICO] Formato AppMap em produto pago.** Antes do lançamento comercial, confirmar com advogado se seguir o formato AppMap (especificação em `referencias/appmap/README.md`) é compatível com a licença. O código do AppMap **não** é usado (CLAUDE.md §2.2).
- **[LICENÇA] Uso do `@appland/appmap-validate` como dependência de desenvolvimento.** O pacote é **MIT puro** (`referencias/appmap-js/packages/validate/LICENSE`), ao contrário do resto do `appmap-js` (MIT + Commons Clause). Proposta: usá-lo só em testes, para conferir compatibilidade, mantendo um validador próprio no produto. Aguardando autorização.

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
