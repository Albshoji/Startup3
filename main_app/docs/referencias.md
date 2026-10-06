# Índice das referências (`referencias/`)

> Somente leitura. Nunca importar nem copiar código daqui (ver CLAUDE.md §2.2 e §13.2).
> Consulte este índice antes de buscar nos repositórios.

| Repositório | Commit lido | Licença |
|---|---|---|
| `appmap/` | `fa68b13` (2026-07-11) | (especificação) |
| `appmap-node/` | `4713c11` (2026-09-21), v2.27.0 | MIT + **Commons Clause** |
| `appmap-js/` | `015ef20` (2026-09-19) | Por pacote, ver tabela abaixo |
| `locatorjs/` | `ac4ed50` (2026-03-01) | MIT |
| `babel-plugin-istanbul/` | `370bcfa` (2026-04-08), v8.0.2 | BSD-3-Clause |

---

## `appmap/`: especificação do formato

| Arquivo | Para que serve |
|---|---|
| `README.md` | Especificação completa: `version`, `metadata` (incl. `recorder.type`: `code, process, requests, remote, tests`; `trimmed`/`sanitized` desde v1.14), `classMap` (package/class/function), `events` (call/return, parameter object, exceptions, `http_server_request/response`, `http_client_request/response`, `sql_query`, `message`), `eventUpdates`, changelog até v1.14.0 |
| `sequence.json.md` | Formato do modelo de diagrama de sequência (`actors` + `rootActions`; `nodeType` 1=Loop, 3=Function, 4=ServerRPC, 5=ClientRPC, 6=Query; `digest`, `subtreeDigest`, `eventIds`) |

## `appmap-node/`: agente Node (referência para os sensores)

| Arquivo | Para que serve |
|---|---|
| `src/bin.ts` | CLI `appmap-node <cmd>`: monta `NODE_OPTIONS` com `--require register.js` + `--loader loader.js` e roda o comando filho |
| `src/register.ts` | Troca `Module.prototype._compile` (transforma o código CJS ao carregar) e faz proxy de `require` (hooks de bibliotecas) |
| `src/loader.ts` | Hook de carregamento ESM (`load`) que chama o mesmo `transform` |
| `src/transform.ts` | Escolhe o hook (next, vitest, mocha, jest, instrument), faz o parse (meriyah) e gera o código de volta (astring); lida com source maps (`getSourceMap`, `shouldMatchOriginalSourcePaths`) |
| `src/hooks/instrument.ts` | **Coração da instrumentação**: quais funções envolver (declarações nomeadas, métodos de classe nomeada, arrow em `const` e `exports.x =`), como envolver (`__appmapRecord.call(this, () => corpo, arguments, registry[i])`), regras de exclusão, registro de funções por arquivo |
| `src/registry.ts` | `FunctionInfo` (id, async, generator, params, static, `klassOrFile`, location, labels) |
| `src/recorder.ts` | `record()`: pula se não há gravação ativa; cria call; executa; return/exception; `Recording.fork` para funções `async`; tipos de gravação (process, remote, requests, tests, block) |
| `src/Recording.ts` | Gera eventos, ids sequenciais, `thread_id: 0`; **buffer por contexto assíncrono** (`AsyncLocalStorage`) para manter a árvore coerente; `fixupPromise` → `eventUpdates`; `finish()` grava `classMap`, `metadata`, `eventUpdates` |
| `src/event.ts` | Formato dos eventos call/return/exception; nomes de parâmetros; cadeia de `cause` das exceções |
| `src/parameter.ts` | Resumo de valores (`util.inspect` com `depth: 1`), esquema (`properties`/`items`, profundidade 5, proteção contra ciclos), `object_id`, tratamento de Promise e elementos React |
| `src/classMap.ts` | Monta o `classMap` a partir das funções vistas: pastas viram `package`, arquivo/classe vira `class` |
| `src/config.ts`, `src/PackageMatcher.ts` | `appmap.yml`: `packages[].path`, `exclude` (trecho de caminho **ou** nome de função/`Classe.metodo`), `shallow`, `functions` (rótulos por nome), `module` (biblioteca); `response_body_max_length` (10 000), `async_tracking_timeout` (3 000 ms) |
| `src/hooks/http.ts` | `http_server_request`/`response` (proxy em `createServer().emit("request")`), `http_client_request`/`response` (proxy em `request`/`get`/`ClientRequest`), captura de corpo, **gravação remota** (`/_appmap/record` GET/POST/DELETE), **gravação por requisição**, requisições ignoradas (`/_next/static`, `.ico`, `.svg`) |
| `src/hooks/next.ts` | Injeta o loader no Next: intercepta `loadConfig` de `next/dist/server/config.js`; webpack (só servidor, sem edge); `turbopack.rules` com `condition: "node"` |
| `src/webpack.ts` | Loader webpack/Turbopack; tira tipos TS com `ts-blank-space` antes do parse |
| `src/hooks/util/CommentLabelExtractor.ts` | Rótulos por comentário `// @label x` / `// @labels a b` acima da função |
| `src/hooks/pg.ts` (e mysql, sqlite, prisma, mongo) | Como uma chamada de biblioteca vira `sql_query` |
| `src/hooks/libraries.ts` | Instrumentação de bibliotecas inteiras (`packages[].module`) por Proxy |
| `src/recorderControl.ts` | Pausa o gravador (evita recursão ao inspecionar valores) |
| `src/AppMapStream.ts` | Escrita em streaming do arquivo (`version` 1.12) |
| `test/next16/`, `test/next16.test.ts` | Teste de integração Next 16 + Turbopack |

## `appmap-js/`: modelos, diagramas e ferramentas

Licenças por pacote: `validate`, `client`, `telemetry` = **MIT**; todos os outros (`models`, `sequence-diagram`, `diagrams`, `components`, `cli`, `scanner`, `navie`, `openapi`, `rpc`, `search`) = **MIT + Commons Clause**.

| Arquivo | Para que serve |
|---|---|
| `packages/models/src/appMapBuilder/index.js` | Leitura do arquivo: aplica `eventUpdates`, normaliza (reindexa ids, fecha calls sem return), `prune(size)` (**corte automático** pelas funções de maior tamanho), `removeNoise` |
| `packages/models/src/appMapBuilder/eventSorter.js`, `eventStack.js` | Desembaraça eventos por `thread_id`, liga call↔return, monta pai/filho, agrupa em "chunks" por requisição |
| `packages/models/src/classMap.js` | Índice de code objects; `bindEvents` cria code objects sintéticos para HTTP, SQL e chamadas externas |
| `packages/models/src/codeObject.js` | `constructDataChainFromEvent` (http → route; http_client → external-service(host) → external-route; sql → database → query), `leafs`/`childLeafs`, conexões de entrada e saída |
| `packages/models/src/codeObjectType.js`, `codeObjectId.js` | Tipos (`package, class, function, http, route, database, query, external-service, external-route`) e formato do fqid |
| `packages/models/src/event.js` | Acessores (`route`, `elapsedTime`, `labels`, `depth`, `stableProperties`, hashes) |
| `packages/models/src/appMapFilter.js` | **Filtros** ("declutter"): `limitRootEvents`, `hideMediaRequests`, `hideExternalPaths`, `hideUnlabeled`, `hideElapsedTimeUnder`, `hideName`, `hideTree`, `context`, raiz; casamento por fqid, `label:`, regex, `*` |
| `packages/models/src/callTree/` | Árvore de chamadas (base do Trace View) |
| `packages/sequence-diagram/src/specification.ts` | Quais code objects viram raias (tipos padrão: package, database, http, external-service), `expand`/`exclude`/`require`, prioridade (HTTP à esquerda, externos e banco à direita) |
| `packages/sequence-diagram/src/buildDiagram.ts` | Eventos → ações (Function/ServerRPC/ClientRPC/Query), digests, detecção de laços |
| `packages/sequence-diagram/src/mergeWindow.ts` | Algoritmo de **detecção de laços** (janelas 1..5) |
| `packages/sequence-diagram/src/priority.ts`, `selectEvents.ts` | Ordem das raias; seleção de eventos |
| `packages/sequence-diagram/src/formatter/plantUML.ts`, `text.ts` | Exportação em texto (referência para o Mermaid) |
| `packages/diagrams/src/componentDiagram/index.js` | **Dependency Map**: nós (leafs renderizáveis), arestas, expandir/recolher, foco, "set as root"; layout dagre `rankdir: LR` |
| `packages/components/src/components/DiagramSequence.vue`, `sequence/DiagramSpec.ts` | Comportamento do diagrama de sequência na UI: recolher por profundidade (padrão 3), ocultar raias, expandir pacotes |
| `packages/components/src/components/trace/` | Trace View (expandir/recolher, valores, links) |
| `packages/components/src/components/flamegraph/`, `src/lib/flamegraph.js` | **Flame Graph**: largura proporcional ao tempo, foco (crown/trunk/branch/pruned), zoom exponencial, cor por tipo |
| `packages/cli/src/cmds/stats/` | `appmap stats`: contagem e tamanho por função |
| `packages/cli/src/cmds/prune/`, `trim/`, `sanitize/` | Corte, encurtamento de valores e mascaramento por comando |
| `packages/scanner/doc/labels/*.md` | Definição dos rótulos conhecidos (`security.*`, `dao.materialize`, `log`, `secret`, `access.public`…) |
| `packages/scanner/src/rules/` | Análises (N+1, falta de autenticação…), evolução futura |
| `packages/validate/` | Validador do formato (**MIT**; usar como dependência exige perguntar) |
| `docs/reference/guides/refine-appmap-data.md` | Processo de refino (stats → exclusões; exemplo do limite de 75 chamadas) |
| `docs/reference/guides/handling-large-appmap-diagrams.md` | Corte automático acima de 10 MB; acima de 200 MB não abre |
| `docs/reference/remote-recording-api.md` | API de gravação remota |
| `docs/reference/appmap-node.md` | Documentação do agente Node (process, remote, requests, tests) |
| `docs/reference/guides/using-appmap-diagrams.md` | O que cada diagrama mostra e convenções (sequência: HTTP à esquerda, banco/RPC à direita) |

## `locatorjs/`: encaixe no Next

| Arquivo | Para que serve |
|---|---|
| `packages/webpack-loader/src/index.ts` | Loader que roda `@babel/core.transformSync` com `babelrc: false, configFile: false`, preset TS e o plugin; devolve source map; **pula `node_modules` e `middleware.`**; em caso de erro devolve o código original |
| `packages/webpack-loader/README.md` | Uso em `turbopack.rules` e em `webpack()` |
| `apps/next-16/next.config.ts` | Exemplo real com Next 16.0.0 + React 19.2 (`"**/*.{tsx,jsx}"`) |
| `packages/babel-jsx/src/index.ts` | Plugin Babel que anota JSX com arquivo:linha |
| `apps/playwright/` | Testes ponta a ponta |

## `babel-plugin-istanbul/`: plugin Babel que instrumenta tudo

| Arquivo | Para que serve |
|---|---|
| `src/index.js` | Estrutura do plugin: trabalho feito em `Program.enter` (antes dos outros plugins) com `path.scope.crawl()`, inclusão/exclusão por `test-exclude` (exclui `node_modules` por padrão), uso do `inputSourceMap` |
| `fixtures/`, `test/` | Casos de inclusão/exclusão e source map embutido |
