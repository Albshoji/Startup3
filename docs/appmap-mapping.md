# Como o AppMap faz → como o Mapa vai fazer

> Documento da Etapa 0, Parte A. Para cada tema: **(1) como o AppMap faz** (com o arquivo de
> origem), **(2) como o Mapa vai fazer** e **(3) onde é diferente e por quê**.
> Caminhos relativos a `referencias/`. Nada aqui é código copiado; as descrições são do
> desenho, e a implementação do Mapa será própria (licença Commons Clause, CLAUDE.md §2.2).
>
> Itens marcados com **[Parte B]** dependem dos testes de risco (`docs/spike-report.md`).

## Sumário
1. [Instrumentação (o "agente")](#1-instrumentação-o-agente)
2. [Filtros: `appmap.yml` → `.mapa/config.json`](#2-filtros-appmapyml--mapaconfigjson)
3. [O que é registrado em cada chamada](#3-o-que-é-registrado-em-cada-chamada)
4. [Pilha assíncrona](#4-pilha-assíncrona)
5. [Requisições HTTP recebidas e feitas](#5-requisições-http-recebidas-e-feitas)
6. [Banco de dados: `sql_query` → pedidos ao Supabase](#6-banco-de-dados-sql_query--pedidos-ao-supabase)
7. [Gravação remota (Start/Stop)](#7-gravação-remota-startstop)
8. [Gravação por requisição → gravação por ação do usuário](#8-gravação-por-requisição--gravação-por-ação-do-usuário)
9. [Gravação de processo](#9-gravação-de-processo)
10. [Formato do arquivo](#10-formato-do-arquivo)
11. [`eventUpdates`](#11-eventupdates)
12. [Rótulos (`labels`)](#12-rótulos-labels)
13. [Estatísticas, refino e corte](#13-estatísticas-refino-e-corte)
14. [Como o arquivo é lido antes de virar diagrama](#14-como-o-arquivo-é-lido-antes-de-virar-diagrama)
15. [Diagrama de sequência](#15-diagrama-de-sequência)
16. [Dependency Map](#16-dependency-map)
17. [Trace View](#17-trace-view)
18. [Flame Graph](#18-flame-graph)
19. [Filtros dos diagramas](#19-filtros-dos-diagramas)
20. [Navie → camada LLM e arquivo de contexto](#20-navie--camada-llm-e-arquivo-de-contexto)
21. [Resumo das diferenças intencionais](#21-resumo-das-diferenças-intencionais)

---

## 1. Instrumentação (o "agente")

### Como o AppMap faz
- **Entrada:** `npx appmap-node <comando>` monta `NODE_OPTIONS` com `--require dist/register.js` e `--loader dist/loader.js` e roda o comando filho (`appmap-node/src/bin.ts`). Os arquivos do usuário não são alterados.
- **CJS:** substitui `Module.prototype._compile` para transformar o código-fonte antes de compilar (`src/register.ts`). **ESM:** hook `load` faz o mesmo (`src/loader.ts`).
- **Transformação** (`src/transform.ts`): faz o parse com **meriyah** (ESTree, com `loc`), aplica um *hook* e gera o código com **astring**. Se der erro, devolve o código original e só avisa (nunca quebra o app).
- **Quais funções são envolvidas** (`src/hooks/instrument.ts`):
  - `FunctionDeclaration` **com nome**;
  - `MethodDefinition` de **classe com nome** (pula métodos *generator* por causa de `super`);
  - `ArrowFunctionExpression` atribuída a **`const x = () => …`** ou a **`exports.x = () => …`**.
  - **Não** envolve: funções anônimas, callbacks inline, arrows em `let`/propriedades de objeto, funções sem `loc` (código gerado).
- **Como envolve:** o corpo vira `return __appmapRecord.call(this, () => {corpo original}, arguments, __appmapFunctionRegistry[i])`. A função original vira uma arrow (preserva `this`, `arguments` e `super`). Para *generators*, `yield* …` com uma `function*`. Parâmetros de funções normais são removidos da função interna (para não avaliar valores padrão duas vezes); nas arrows, a lista de parâmetros vira `(...$appmap$args)`.
- **Registro de funções:** no topo do arquivo é inserido `const __appmapFunctionRegistry = [ {id, async, generator, params, static, klassOrFile, location, labels}, … ]` (`src/registry.ts`). Também é inserida uma verificação defensiva: se `global.AppMapRecordHook` não existir, chama a função original sem gravar.
- **Source maps:** se o arquivo tem `sourceMappingURL`, cada função é localizada no **arquivo original** (`originalPositionFor`), e a decisão de instrumentar é tomada **por arquivo original**, não pelo arquivo empacotado (`instrument.ts: shouldSkipFunction`). Source maps de `node_modules` e `.next` são ignorados.
- **Next.js** (`src/hooks/next.ts`): o agente intercepta `loadConfig` em `next/dist/server/config.js` e injeta o loader (`src/webpack.ts`):
  - webpack: `config.module.rules.unshift({test: /\.(tsx|ts|js|cjs|mjs|jsx)$/, use: loader})` **só no servidor e fora do runtime edge**;
  - Turbopack: `turbopack.rules["*.ext"] = {loaders: [loader], condition: "node"}`;
  - no Turbopack o loader recebe **TypeScript cru**: tira os tipos com `ts-blank-space` (mantém posições); `enum`, `namespace` e propriedades de parâmetro de construtor quebram o parse e o arquivo fica sem instrumentação (o agente avisa).
- **Bibliotecas e drivers:** proxy em `require` para `http`, `pg`, `mysql`, `sqlite`, `prisma`, `mongo` (`src/requireHook.ts`, `src/hooks/*.ts`).

### Como o Mapa vai fazer
- **Entrada:** `npx mapa dev` liga `next dev` com `MAPA=1` e sobe o coletor. `withMapa(nextConfig)` (gerado pelo `mapa init`) só age com `MAPA=1`.
- **Ponto de encaixe:** em vez de interceptar `loadConfig` por dentro do Next (o AppMap precisa disso porque não toca no projeto), o Mapa usa **`withMapa` no `next.config`**, que registra **nosso loader** (padrão LocatorJS, `locatorjs/packages/webpack-loader/src/index.ts`):
  - Turbopack: **duas regras**, uma com condição `browser` e outra com condição "não `browser`", ambas excluindo `foreign` (node_modules e internos do Next) **[Parte B, risco 1]**;
  - webpack: regra para cliente e regra para servidor (`isServer`, `nextRuntime`), excluindo `node_modules`.
- **Transformação:** **plugin Babel nosso** (`@babel/core.transformSync` com `babelrc: false, configFile: false`, como o LocatorJS, **sem nunca criar `babel.config.js`**). Parser do Babel com `typescript` + `jsx`: **mantém o TypeScript** (não remove tipos) e só insere os envoltórios, deixando o SWC/Turbopack compilar o resto. Assim evitamos a limitação do `ts-blank-space` (enum/namespace).
- **Quais funções:** o mesmo conjunto do AppMap **mais**:
  - componentes React (`function Comp()`, `const Comp = () =>`, `export default function`), que o AppMap já pega se tiverem nome;
  - `export default function` anônima → nome a partir do arquivo (ex.: `page`, `layout`, `route`);
  - handlers de rota (`export async function GET/POST…`), **server actions** (funções em arquivos ou blocos `"use server"`);
  - arrow em `let`/`var`, `export const`, e propriedades de objeto com nome (`const api = { salvar: async () => … }`), opcional por configuração;
  - **callbacks inline** (ex.: `onClick={() => …}`) recebem um nome sintético (`Componente.onClick@linha`). Motivo: no público-alvo quase todo handler de clique é inline, e sem isso o cenário B perderia o elo "clique → handler".
- **Envoltório:** mesma ideia (corpo vira função interna chamada por `__mapa.record(this, fn, arguments, meta)`), mas com cuidado com:
  - **diretivas** `"use client"`, `"use server"` precisam continuar como **primeira instrução** do arquivo/função;
  - **server actions:** o Next identifica a action pela função exportada; o envoltório não pode mudar a identidade da exportação **[Parte B]**;
  - **hooks do React:** envolver componentes não pode mudar a ordem dos hooks (o envoltório chama o corpo uma vez e de forma síncrona, então a ordem não muda);
  - **Fast Refresh:** o React Refresh identifica componentes pelo nome e assinatura; o envoltório deve preservar o nome da função **[Parte B, risco 4]**.
- **Registro de funções:** uma tabela por arquivo, como o AppMap, com `location` relativa à raiz do projeto, `layer` (`browser` | `next-server`) e o id da função.
- **Source maps:** gerar o mapa no Babel (`sourceMaps: true`) e passar adiante pelo callback do loader (como o LocatorJS); localização arquivo:linha vem do **AST original** (não depende de `_debugSource`, removido no React 19).
- **Falha segura:** se o parse falhar, devolver o código original e avisar uma vez (igual ao AppMap e ao LocatorJS).

### Onde é diferente e por quê
| Diferença | Motivo |
|---|---|
| Plugin no bundler, não `--require`/`--loader` do Node | Código do navegador nunca passa pelo Node; o Next empacota tudo |
| Babel em vez de meriyah + astring | Babel entende TS/JSX nativamente e é o caminho suportado de loader no Turbopack (LocatorJS); evita a limitação do `ts-blank-space` |
| `withMapa` no `next.config` em vez de interceptar `loadConfig` | O público aceita uma linha no config (via `mapa init`) e isso é estável entre versões do Next; interceptar internos do Next é frágil |
| Instrumenta também o **navegador** (o AppMap só faz `condition: "node"` / `isServer`) | É exatamente o que o AppMap não cobre e o motivo do produto |
| Callbacks inline e componentes recebem nome | Público vibe coder escreve handlers inline; precisamos do elo clique → handler |
| Middleware/proxy | LocatorJS pula `middleware.` de propósito; o AppMap exclui o runtime `edge`. O Mapa tenta instrumentar; se não der, registra só que rodou **[Parte B, risco 1]** |

---

## 2. Filtros: `appmap.yml` → `.mapa/config.json`

### Como o AppMap faz
`appmap-node/src/config.ts` e `src/PackageMatcher.ts`:
- `packages: [{ path, exclude, shallow, functions, module }]`. Padrão: `[{path: ".", exclude: ["node_modules", ".yarn"]}]`.
- **Casamento de arquivo:** o primeiro pacote cujo `path` resolvido é **prefixo** do caminho do arquivo; o arquivo é descartado se **algum item de `exclude` aparece como substring** do caminho.
- **Casamento de função:** a função é descartada se `exclude` contém o **nome** (`findUser`) ou o nome qualificado **`Classe.metodo`**. Ou seja, `exclude` mistura caminhos e nomes.
- `shallow: true`: não grava chamadas de um pacote para ele mesmo (só a "entrada" no pacote).
- `functions: [{name(s), label(s)}]`: aplica rótulos por nome.
- `module`: instrumenta uma biblioteca de `node_modules` por Proxy.
- Outras chaves: `name`, `appmap_dir` (padrão `tmp/appmap`), `language`, `response_body_max_length` (10 000), `async_tracking_timeout` (3 000 ms); variáveis de ambiente `APPMAP_*` têm prioridade.
- Se não existe `appmap.yml`, o agente **cria um padrão** e avisa.

### Como o Mapa vai fazer
`.mapa/config.json` com **a mesma semântica** e nomes equivalentes:
```json
{
  "name": "meu-app",
  "packages": [
    { "path": "app" },
    { "path": "components" },
    { "path": "lib", "exclude": ["lib/generated", "formatarData", "Api.log"], "shallow": false }
  ],
  "functions": [{ "names": ["verificarLogin"], "labels": ["security.authentication"] }],
  "limits": { "maxSeconds": 120, "maxEvents": null, "maxMegabytes": null },
  "mask": { "fields": [] },
  "valueMaxLength": 100,
  "responseBodyMaxLength": 10000
}
```
- Padrão gerado pelo `mapa init`: todo o projeto (`"."`) com `exclude` de `node_modules`, `.next`, `.mapa`, `public`, `supabase/functions` (Deno, roda fora do app).
- Mesmas regras de casamento (prefixo para `path`, substring para caminho em `exclude`, nome ou `Classe.metodo` para função).
- **Avaliado em tempo de transformação** (no loader) para caminhos e nomes. Mudança no config: o loader declara o arquivo como dependência (`this.addDependency`) para o bundler recompilar.
- Os limites de gravação (§9 do CLAUDE.md) também ficam aqui (o AppMap não tem limite; ver §7).
- `module` (bibliotecas): **fora do MVP**. O Supabase é capturado pela rede, não por instrumentar `supabase-js`.

### Onde é diferente e por quê
- JSON em vez de YAML: o público mexe pouco nesse arquivo, e JSON pode ser lido no navegador sem dependência extra. A semântica é a mesma, então a conversão é direta.
- `exclude` separado em caminho/nome continua **misturado**, como no AppMap, para manter a compatibilidade mental com o `appmap.yml` e com o processo de refino (§13).

---

## 3. O que é registrado em cada chamada

### Como o AppMap faz
`appmap-node/src/event.ts`, `src/parameter.ts`, `src/Recording.ts`:
- **call:** `id` (sequencial por gravação), `event: "call"`, `thread_id: 0` (fixo no Node), `defined_class` (nome da classe **ou nome do arquivo sem extensão** para funções soltas), `method_id`, `path` e `lineno` (relativos à raiz), `static` (= não tem `this`), `receiver` (o `this`, se houver), `parameters` (cada um com `name`, `class`, `value`, `object_id`, `size` para arrays, `properties`/`items` como esquema).
- **return:** `id`, `parent_id`, `elapsed` (s, via `hrtime`), `return_value` **ou** `exceptions` (`class`, `message`, `object_id`, e a cadeia de `cause` como exceções seguintes).
- **Valor:** `util.inspect(valor, {depth: 1})` com o gravador **pausado** (para não gravar chamadas feitas pelo próprio `inspect`). Casos especiais: `IncomingMessage`, `ServerResponse`, `ClientRequest`, elementos React (`[React element Nome]`), Promise (`Promise { <pending> }`, atualizado depois).
- **Esquema:** `properties` para objetos simples e `items` para arrays homogêneos, até profundidade 5, com proteção contra ciclos.
- **Não grava** `timestamp` (opcional na especificação desde v1.13).
- **Não encurta** `value` para 100 caracteres no agente Node (a especificação recomenda 100). O encurtamento existe como comando separado (`appmap trim`, `appmap-js/packages/cli/src/cmds/trim/`).

### Como o Mapa vai fazer
- Mesmos campos e mesmo significado. `defined_class`: classe, ou **nome do componente/módulo** (arquivo sem extensão) para funções soltas.
- `thread_id`: **um por "linha de execução" lógica**: `1` = navegador (aba), `2..n` = cada requisição recebida pelo servidor do Next (ver §4). Isso permite ao leitor de AppMap desembaraçar o que é concorrente.
- `timestamp` **sempre** gravado (época em segundos): é ele que permite juntar navegador + servidor + registros do Supabase numa linha do tempo só.
- **Valor:** resumo próprio, seguro para navegador e servidor (não há `util.inspect` no navegador): tipo + conteúdo curto, **encurtado para ~100 caracteres já na captura** (economiza volume; §9.2 do CLAUDE.md), elementos React como `[React element Nome]`, funções como `[Function nome]`, eventos do DOM como `[click on button "Adicionar"]`.
- **Mascaramento antes de resumir** (senha, token, cookie, `authorization`, `apikey`, e-mail, CPF, cartão): no lugar de grava `"[mascarado]"` (ver §10, `metadata.sanitized`).
- Esquema `properties`/`items` igual, com profundidade menor (3) para conter volume **[Parte B, risco 4]**.
- Extensão: `layer: "browser" | "next-server"` em cada `call` (documentado em `docs/format.md`).

### Onde é diferente e por quê
- Encurtar e mascarar **na captura**, não só depois: o navegador do usuário tem memória limitada e os dados sensíveis não devem nem chegar ao coletor.
- `thread_id` com significado e `timestamp` sempre presente: são duas fontes (navegador e servidor) que precisam ser juntadas.

---

## 4. Pilha assíncrona

### Como o AppMap faz
`appmap-node/src/recorder.ts` e `src/Recording.ts`:
- O "pai" de cada evento é implícito: a **ordem** dos eventos no arquivo (todos com `thread_id: 0`). Um leitor monta a árvore empilhando calls e desempilhando nos returns (`appmap-js/packages/models/src/appMapBuilder/eventStack.js`).
- Problema: com `async`, eventos de tarefas diferentes se intercalam. Solução do AppMap: ao chamar uma função `async`, o gravador faz `Recording.fork()`, que cria um **buffer** filho e roda a função dentro de `AsyncLocalStorage.run(buffer, …)`. Todo evento emitido nessa continuação vai para o buffer daquele contexto, e os buffers formam uma árvore. No final, a árvore é "achatada" na ordem certa, de modo que os filhos de uma chamada `async` ficam **logo depois do call dela** no arquivo.
- O return de uma função `async` é emitido **na hora** (com o valor `Promise { <pending> }`) e corrigido quando a Promise resolve (`fixupPromise`): se o evento ainda está no buffer, é atualizado no lugar; senão, vai para `eventUpdates`.
- Proteção: se um buffer fica aberto mais de `async_tracking_timeout` (3 s), os eventos são liberados para o arquivo mesmo assim.

### Como o Mapa vai fazer
- **Servidor do Next:** mesmo mecanismo conceitual com `AsyncLocalStorage` **[Parte B, risco 2]**, mas com **pais explícitos**: cada call grava `parent_id` da chamada que estava no topo do contexto assíncrono. Isso dispensa o achatamento por buffers e tolera o fato de o servidor do Next processar várias requisições ao mesmo tempo.
- **Navegador:** não existe `AsyncLocalStorage` (AsyncContext ainda é Stage 2; zone.js não pega `async/await` nativo). O plugin Babel **marca cada `await`** dentro das funções instrumentadas: antes do `await`, salva a pilha atual; ao retomar, restaura a pilha salva e descarta o que outra tarefa deixou por cima. Esboço (código gerado):
  ```js
  const __s = __mapa.save(); const r = await x; __mapa.restore(__s);
  ```
  Também envolvemos `setTimeout`, `queueMicrotask`, `requestAnimationFrame`, `Promise.prototype.then` e listeners de eventos para levar o contexto **[Parte B, risco 2]**.
- O return de função `async` segue o AppMap: return imediato e **correção ao resolver** (no Mapa, sempre pelo coletor, antes de fechar o arquivo; `eventUpdates` só para o que chega depois do Stop).
- A gravação no formato final continua compatível com a reconstrução pela ordem: o coletor **reordena** cada `thread_id` por árvore de pais antes de escrever.

### Onde é diferente e por quê
- `parent_id` explícito no `call` (extensão; a especificação só tem `parent_id` no return): duas fontes concorrentes e um navegador sem `AsyncLocalStorage` tornam a ordem implícita frágil. O arquivo continua válido no formato base porque a ordem final também é reconstruída.

---

## 5. Requisições HTTP recebidas e feitas

### Como o AppMap faz
`appmap-node/src/hooks/http.ts`:
- **Recebidas:** proxy em `http.createServer`, interceptando `server.emit("request")`. Grava `http_server_request` (`request_method`, `path_info`, `protocol`, `headers` normalizados `Content-Type`), query string como `message` (lista de parâmetros). No `finish` da resposta grava `http_server_response` (`status_code`, `headers`, `return_value` com o corpo, até 10 000 caracteres; JSON vira parâmetro com esquema). `normalized_path_info` e parâmetros de rota/corpo entram depois (`fixup`) quando o framework os expõe (Express).
- **Ignoradas:** `/_next/static/`, `/_next/image/`, `.ico`, `.svg`.
- **Feitas:** proxy em `http.request`, `http.get` e `ClientRequest`. Grava `http_client_request` (`request_method`, `url` **sem query**, `headers`) e `http_client_response` (`status_code`, `headers`, `return_value`).
- Observação: o `fetch` nativo do Node (undici) **não passa** por `http.request`, então o agente Node não grava o `fetch` do `supabase-js` no servidor.

### Como o Mapa vai fazer
- **Servidor do Next, recebidas:** gravador de servidor (`server-runtime`) com o mesmo conteúdo do AppMap. Pontos de encaixe a validar **[Parte B]**: `instrumentation.ts` do Next (`register`) + `AsyncLocalStorage` por requisição; alternativa: aproveitar os spans OpenTelemetry que o Next já cria (`BaseServer.handleRequest`, rota, status). Ligação com o navegador pelo cabeçalho `traceparent` (só mesma origem).
- **Servidor do Next, feitas:** envolver `globalThis.fetch` (é por onde o `supabase-js` fala) e, se necessário, `diagnostics_channel` do undici (`undici:request:create`/`headers`) **[Parte B, risco 3]**.
- **Navegador:** envolver `fetch` e `XMLHttpRequest`; mesmo formato `http_client_request`/`http_client_response`, com corpo resumido e mascarado. `traceparent` **só** para a mesma origem.
- **Query string em `message`**, como manda a especificação (o agente Node não faz isso). É essencial para o PostgREST (`select=`, `id=eq.5`, `order=`).
- Corpo da requisição: a especificação não tem campo de corpo para `http_client_request`; gravamos os campos do corpo também em `message` (com `kind: "body"`), como o AppMap faz para parâmetros de corpo em requisições recebidas (`fixupEvent`).
- Mesmas requisições ignoradas, mais as internas do Next em dev (`/__nextjs_original-stack-frame`, HMR `/_next/webpack-hmr`, `?_rsc=` só quando for prefetch) e as do coletor do Mapa.

### Onde é diferente e por quê
- `fetch` é o caminho principal (navegador e servidor), não `http.request`.
- `traceparent` só na mesma origem: enviar para o Supabase dispara preflight CORS e pode quebrar a requisição.

---

## 6. Banco de dados: `sql_query` → pedidos ao Supabase

### Como o AppMap faz
- O agente intercepta o **driver** (`pg.Client.prototype.query`, `appmap-node/src/hooks/pg.ts`) e grava um `call` com `sql_query` (`database_type`, `sql`) seguido de return com `elapsed`.
- Nos modelos, todo `sql_query` vira o code object `database:Database → query:<sql>` (`appmap-js/packages/models/src/codeObject.js: constructDataChainFromEvent`), que aparece à **direita** no diagrama de sequência e roxo no flame graph.

### Como o Mapa vai fazer
- Não há driver: o app fala com o Supabase por HTTP. Cada pedido é gravado como `http_client_request`/`http_client_response` (formato base) e **traduzido** (pacote `supabase`) para a operação equivalente, gravada numa extensão `supabase` no mesmo evento:
  ```json
  "supabase": {
    "service": "rest|auth|storage|functions|realtime",
    "operation": "select|insert|update|delete|upsert|rpc|signup|login|refresh|logout|upload|download|remove|invoke|subscribe",
    "table": "items", "filters": [{"column":"owner_id","op":"eq","value":"…"}],
    "select": "id,nome", "order": "...", "limit": 10,
    "role": "authenticated", "user_id": "uuid",
    "certainty": "recorded"
  }
  ```
- Para os diagramas, o tradutor também gera uma **forma SQL legível** (`select id,nome from items where owner_id = …`), e o evento traduzido é tratado como `Query` (nodeType 6) na sequência e como "banco" nas cores, exatamente como o AppMap trata `sql_query`. O texto SQL **não** é gravado como `sql_query` no arquivo, para não fingir que a consulta foi vista no banco: ele é derivado.
- Raias à direita, divididas por serviço: **API (REST)**, **Login (Auth)**, **Arquivos (Storage)**, **Funções (Edge)**, **Tempo real**, **Banco** (o que é "configurado no banco": RLS, gatilhos).

### Onde é diferente e por quê
- O Supabase é um serviço externo por HTTP. No AppMap, um `http_client_request` vira **um único** code object `external-service:<host>`. Com isso, tudo do Supabase cairia numa raia só. O Mapa separa por serviço porque, para o público, "login", "dados" e "arquivos" são coisas diferentes.

---

## 7. Gravação remota (Start/Stop)

### Como o AppMap faz
`appmap-node/src/hooks/http.ts: handleRemoteRecording` e `docs/reference/remote-recording-api.md`:
- Endpoints **na mesma porta do app**: `GET /_appmap/record` → `{enabled}`; `POST` → inicia (409 se já houver); `DELETE` → para e devolve o AppMap no corpo (404 se não houver).
- Ao iniciar, a gravação de processo é abandonada e começa uma gravação `remote`. Ao parar, o arquivo é finalizado, enviado na resposta e apagado do disco.
- **Não existe limite** de tempo ou tamanho.

### Como o Mapa vai fazer
- O **coletor local** é o dono do Start/Stop (porta própria, só `localhost`), com a mesma API: `GET/POST/DELETE /record`. Quem chama: o botão flutuante, `npx mapa record start|stop` e os gravadores (navegador e servidor), que consultam o estado.
- O servidor do Next e o navegador **mandam eventos ao coletor** (o AppMap guarda tudo dentro do processo). Motivo: são duas fontes (navegador + servidor), possivelmente várias abas.
- **Limites** (tempo, número de eventos, MB) com parada automática; ao parar, salva o que foi gravado e avisa.
- Fora de gravação, os sensores ficam inativos (custo quase zero: o envoltório só verifica uma flag, como `record()` faz quando `getActiveRecordings()` está vazio).

### Onde é diferente e por quê
- Coletor separado: junta navegador e servidor e aplica limites, refino e mascaramento num ponto só.
- Limites: o público não sabe configurar exclusões; sem limite, uma gravação esquecida cresceria sem controle.

---

## 8. Gravação por requisição → gravação por ação do usuário

### Como o AppMap faz
- Quando não há gravação remota nem de teste, **cada requisição HTTP recebida** abre uma gravação `requests` e, no `finish` da resposta, grava um arquivo `tmp/appmap/requests/<timestamp> <path>.appmap.json` com nome `MÉTODO caminho (status) — timestamp` (`hooks/http.ts: handleRequest`).
- Nos modelos, `limitRootEvents` mantém só as árvores cuja raiz é um "comando" (requisição HTTP ou rótulos `cli.command`, `job.perform`, `message.handle`, `appmap-js/packages/models/src/appMapFilter.js`).

### Como o Mapa vai fazer
- Dentro da gravação (Start → Stop), cada **ação do usuário** (clique, envio de formulário, navegação) abre uma **interação**: um evento sintético `call` com `defined_class: "Browser"`, `method_id: click|submit|navigate`, `labels: ["mapa.user-action"]` e a descrição do elemento. Tudo o que acontecer por causa dela (funções, `fetch`, requisições ao servidor ligadas por `traceparent`, pedidos ao Supabase) fica **abaixo** dela.
- A interação termina quando não há mais atividade ligada a ela (sem `fetch` pendente, sem tarefas no contexto) por um intervalo curto **[Parte B: calibrar, ponto de partida 500 ms]**.
- `interactions.json` = índice das interações (id do evento, tipo, elemento, início, fim, quantidade de eventos), equivalente aos arquivos por requisição do AppMap, mas sem duplicar eventos: um arquivo só, com índice.
- O conceito de "comando" (`limitRootEvents`) passa a incluir `mapa.user-action`.

### Onde é diferente e por quê
- No navegador, a unidade de trabalho que o usuário entende é "o que eu cliquei", não a requisição HTTP.

---

## 9. Gravação de processo

### Como o AppMap faz
Sempre há uma gravação `process` ativa; ela é abandonada quando começa outra (remota, requisição, teste), a não ser com `APPMAP_RECORDER_PROCESS_ALWAYS` (`appmap-node/src/recorder.ts`).

### Como o Mapa vai fazer
A sessão entre Start e Stop é o equivalente (com `metadata.recorder.type: "remote"`). **Não** existe gravação desde o início do processo: só se grava com Start (o público não deve gerar volume sem querer).

---

## 10. Formato do arquivo

### Como o AppMap faz
- `appmap/README.md` (v1.14.0). O agente Node escreve `"version":"1.12"` (`appmap-node/src/AppMapStream.ts`) em streaming: `events` primeiro e, no fim, `classMap`, `metadata` e `eventUpdates`.
- `metadata`: `client` (name, url, version), `language` (`javascript`, engine `Node.js`, versão), `app`, `recorder` (`type`, `name`), `name`. Exceção não tratada vai em `metadata.exception`.
- `classMap` montado **só com as funções que rodaram** (`src/classMap.ts`): cada pasta do caminho vira `package`; o arquivo (ou classe) vira `class`; as funções ficam dentro, com `location` = `caminho:linha`, `static`, `labels`. Pacotes únicos no topo são "achatados".
- Regra importante da especificação: `path` + `lineno` do call **devem bater** com o `location` da função no `classMap` (é assim que os modelos ligam evento ↔ código, `appmap-js/packages/models/src/classMap.js: codeObjectFromEvent`).

### Como o Mapa vai fazer
- **`version: "1.14"`**, mesmo `metadata`, com `client.name: "mapa"`, `language.name: "javascript"`, `frameworks: [{name:"next",version}, {name:"react",version}, {name:"@supabase/supabase-js",version}]`, `recorder: {type:"remote", name:"mapa"}`, `git` quando houver repositório, `sanitized`/`trimmed` preenchidos porque sempre mascaramos e encurtamos.
- `classMap` com o mesmo método, mais uma divisão por camada no topo: `package "browser"` e `package "next-server"` (uma mesma pasta pode rodar nos dois lados).
- Extensões (detalhadas em `docs/format.md`, a escrever na Etapa 1): `layer`, `parent_id` no call, `supabase` (§6), `mapa.user-action`, WebSocket (abaixo), `certainty`.
- **WebSocket (Realtime):** não existe tipo no formato. Proposta: conexão como `http_client_request` com `request_method: "GET"` + `Upgrade: websocket` (fiel ao que acontece no protocolo) e cada mensagem como `call` com `message` (formato base: "receipt of a message") com `defined_class: "Realtime"`, `method_id: "send"|"receive"`, `labels: ["mapa.websocket"]`.
- **Validação:** validador próprio pela especificação (JSON Schema). O `@appland/appmap-validate` é **MIT** (`appmap-js/packages/validate/LICENSE`) e poderia ser usado como dependência de desenvolvimento para testes de compatibilidade: **pergunta pendente ao dono do projeto** (CLAUDE.md §2.2).

---

## 11. `eventUpdates`

### Como o AppMap faz
- Objeto `{ "<id>": <evento completo> }` que **substitui** o evento original (`appmap/README.md`). O leitor troca os eventos ao carregar (`appmap-js/packages/models/src/appMapBuilder/index.js: source`).
- O agente usa para: resultado de Promise que resolve depois que o evento já foi escrito (`Recording.fixupPromise`) e `normalized_path_info`/parâmetros que só ficam conhecidos no fim da requisição (`hooks/http.ts: fixupEvent`).

### Como o Mapa vai fazer
- O arquivo gerado no computador já sai **sem** `eventUpdates` internos sempre que possível (o coletor corrige antes de escrever).
- **No site**, os registros do Supabase (que chegam minutos depois) são aplicados como `eventUpdates`: o evento do pedido é reescrito com `supabase.logs` (status do banco, erro detalhado, `console.log` da Edge Function, e-mail de confirmação enviado) e `certainty: "logs"`.
- Para o que é **novo** (não corresponde a nenhum evento gravado: gatilho, cascata), não dá para usar `eventUpdates` (ele só substitui ids existentes). Proposta: o evento do pedido ganha filhos **sintéticos** inseridos pelo site numa **cópia derivada** do arquivo (`recording.enriched.appmap.json`), com `certainty: "schema"` ou `"logs"`; o arquivo bruto original fica intacto. Decisão registrada em `docs/decisions.md`.

---

## 12. Rótulos (`labels`)

### Como o AppMap faz
- Rótulos em funções do `classMap` (`labels`), vindos de: comentário `// @label x` / `// @labels a b` acima da função (`appmap-node/src/hooks/util/CommentLabelExtractor.ts`) e configuração `functions: [{names, labels}]` (`src/config.ts: getFunctionLabels`).
- Rótulos conhecidos e o que significam: `appmap-js/packages/scanner/doc/labels/*.md`: `security.authentication`, `security.authorization`, `security.logout`, `access.public`, `dao.materialize`, `log`, `secret`, `crypto.*`, `jwt.*`, `http.session.clear`, `job.*`, `rpc.circuit_breaker`, `system.exec*`, `deserialize.*`, `string.equals`, `command.perform`, `audit`.
- Nos modelos, `event.labels` = rótulos do evento + do code object; filtros por `label:` e `hideUnlabeled` (`appMapFilter.js`).

### Como o Mapa vai fazer
- Mesmas duas fontes (comentário `// @label` e `functions` no config).
- Rótulos **automáticos** pela tradução do Supabase:

| Pedido | Rótulo |
|---|---|
| `GET /rest/v1/<tabela>` | `dao.materialize` |
| `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/otp`, `/auth/v1/verify` | `security.authentication` |
| `/auth/v1/logout` | `security.logout` |
| `/auth/v1/user` (consulta do usuário) | `security.authentication` |
| Política RLS aplicada (estrutura) | `security.authorization` |
| Pedido feito sem usuário logado (papel `anon`) | `access.public` |
| `console.*` no app e `console.log` da Edge Function | `log` |

- Rótulos próprios (prefixo `mapa.`) só quando não há equivalente: `mapa.user-action`, `mapa.websocket`, `mapa.server-action`, `mapa.react-component`, `mapa.route-handler`, `mapa.middleware`.

---

## 13. Estatísticas, refino e corte

### Como o AppMap faz
- **`appmap stats`** (`appmap-js/packages/cli/src/cmds/stats/accumulateEvents.ts`): conta, por função (fqid do code object), o **número de chamadas** e o **tamanho estimado** (`JSON.stringify(evento).length`), ignorando HTTP e SQL; ordena por contagem.
- **Processo de refino** (`docs/reference/guides/refine-appmap-data.md`): gravar com configuração ampla → `stats` → excluir as funções muito repetidas (exemplo: mais de **75 chamadas**, "não há nada de especial nesse número") → gravar de novo.
- **Corte automático** (`docs/reference/guides/handling-large-appmap-diagrams.md` e `models/src/appMapBuilder/index.js: prune`): acima de **10 MB** o visualizador corta **em memória** até ~10 MB, removendo as funções de **maior tamanho total** (soma por code object) até caber; nunca remove HTTP nem SQL; registra o que cortou em `pruneFilter.hideName` e avisa no painel Stats. Acima de **200 MB** não abre, só mostra estatísticas.
- **`trim`** encurta valores, **`sanitize`** mascara valores (marcam `metadata.trimmed`/`sanitized`).

### Como o Mapa vai fazer
- `npx mapa stats <gravação>`: mesma saída (função, contagem, tamanho estimado, localização), em português.
- Sugestão automática no fim de cada gravação: "estas funções foram chamadas mais de 75 vezes; quer excluí-las?" → aceita grava no `exclude` do `.mapa/config.json`.
- Corte automático no **site** com o mesmo algoritmo (maior tamanho total primeiro, nunca remove requisições, pedidos ao Supabase nem ações do usuário), avisando o que foi cortado. Limite de corte a definir na Parte B (o AppMap usa 10 MB para abrir no editor; o site pode usar outro valor).
- Também no **coletor**, antes de enviar, como proteção do tamanho do envio.
- `trim`/`sanitize` são feitos **sempre**, na captura e de novo no coletor.

---

## 14. Como o arquivo é lido antes de virar diagrama

### Como o AppMap faz
`appmap-js/packages/models/src/appMapBuilder/*` e `classMap.js`:
1. aplica `eventUpdates`;
2. separa por `thread_id` e liga call ↔ return; returns sem call são descartados;
3. **normaliza**: reindexa ids, fecha calls sem return com returns vazios;
4. liga cada call a um **code object** (`path:lineno` + `method_id` → função do `classMap`); se não achar, cria um sintético: HTTP recebido → `http:HTTP server requests` → `route:<MÉTODO caminho>`; HTTP feito → `external-service:<host>` → `external-route:<MÉTODO url>`; SQL → `database:Database` → `query:<sql>`; função sem `classMap` → `class:<defined_class>` → `function:<method_id>`;
5. **fqid** = tipo + caminho na árvore (`codeObjectId.js`; separadores `/` entre pacotes, `::` para classes, `.` função estática, `#` de instância).

### Como o Mapa vai fazer
Mesmo pipeline, em código nosso (pacote `diagrams`), com duas mudanças:
- usar `parent_id` do call quando existir (§4);
- code objects sintéticos para as extensões: `user-action:<tipo> <elemento>` (raia **Usuário**), serviços do Supabase (`supabase-service:Login`, `supabase-service:API`, …), `supabase-table:<tabela>`, `supabase-policy:<nome>`, `supabase-trigger:<nome>`, `supabase-bucket:<nome>`, `supabase-function:<nome>`.

---

## 15. Diagrama de sequência

### Como o AppMap faz
`appmap-js/packages/sequence-diagram/src/` + `appmap/sequence.json.md` + `components/src/components/DiagramSequence.vue`:
- **Raias (actors):** code objects dos tipos `package`, `database`, `http`, `external-service` que **têm filhos não-pacote** (ou seja, o pacote "folha" que contém classes) (`specification.ts: build`). `expand` troca um pacote pelas suas classes; `exclude` remove; `require` restringe aos eventos sob certos code objects.
- **Ordem das raias** (`priority.ts`): `http:HTTP server requests` = 0 (**esquerda**); serviços externos (ordenados) e depois `database:Database` recebem prioridade alta (**direita**); os demais pacotes entram na ordem em que aparecem (1000, 2000, …).
- **Ações** (`buildDiagram.ts`): percorre os eventos selecionados com uma pilha; cada call de evento incluído vira ação `ServerRPC` (4, rota + status), `ClientRPC` (5, rota + status), `Query` (6, SQL) ou `Function` (3, nome, static, tipo do retorno, exceção), com `caller` = raia do evento pai e `callee` = raia do evento; filhos aninhados; `eventIds` aponta para os eventos.
- **Digests:** `digest` estável por ação (hash de propriedades estáveis) e `subtreeDigest` (hash do digest + subárvores dos filhos).
- **Laços** (`mergeWindow.ts`): para janelas de 1 a 5 filhos consecutivos, procura sequências repetidas pelo `subtreeDigest` e funde em `Loop` (1) com `count`, somando `eventIds` e `elapsed`.
- **UI:** começa **recolhido a partir da profundidade 3** (`DEFAULT_SEQ_DIAGRAM_COLLAPSE_DEPTH`); `[+]`/`[-]` por ação; raias podem ser ocultadas (X) e restauradas por filtro; retornos desenhados na direção oposta; exporta SVG e PlantUML; "mostrar na árvore / no flame graph".

### Como o Mapa vai fazer
- Mesmo modelo JSON (`actors` + `rootActions`, mesmos `nodeType`, `digest`, `subtreeDigest`, `eventIds`, laços com janelas 1..5).
- **Raias fixas por grupo e ordem**, mapeando para o mecanismo de prioridade do AppMap:
  1. **Usuário** (ações sintéticas): prioridade 0 (o lugar das requisições HTTP no AppMap);
  2. **Tela**: um ator por pasta de componentes do navegador (`package` folha da camada `browser`);
  3. **Servidor do Next**: `http:HTTP server requests` + pastas da camada `next-server`;
  4. **Supabase**: API, Login, Arquivos, Funções, Tempo real, Banco (à direita, como serviços externos + banco no AppMap).
- Nenhum `nodeType` novo: a ação do usuário é `Function` com `callee` = raia **Usuário** e `stableProperties.event_type = "user-action"` (usar `ServerRPC` daria a ela um significado de requisição HTTP que ela não tem). Pedido ao Supabase traduzido = `Query` (dados: REST e RPC) ou `ClientRPC` (Login, Arquivos, Funções, Tempo real).
- **Começa no nível mais simples** (profundidade 1: Usuário → Tela → Servidor → Supabase) e o usuário expande; no AppMap o padrão é 3, mas o público é leigo.
- Passos "configurados no banco" (gatilho, RLS) entram como filhos do pedido na raia **Banco**, com marcação de grau de certeza.
- Exportação **Mermaid** (`sequenceDiagram`) seguindo o formatador PlantUML do AppMap como referência de estrutura.

---

## 16. Dependency Map

### Como o AppMap faz
`appmap-js/packages/diagrams/src/componentDiagram/index.js` + `models/src/codeObject.js`:
- **Nós:** para cada raiz do `classMap`, pega os `leafs()` (o pacote mais específico que contém outra coisa que não pacote); se um nó tem um único filho renderizável, mostra o filho. Tipos renderizáveis: `database`, `http`, `external-service`, `route`, `package`, `class`.
- **Arestas:** `outboundConnections` = code objects dos **eventos filhos** de cada evento do nó; cria aresta para o code object e para **todos os seus ancestrais** (para que a aresta exista em qualquer nível de expansão); remove laços (de/para o mesmo nó).
- **Interação:** expandir pacote/HTTP mostra as classes (ou rotas), recolher volta ao pacote; clicar destaca e mostra detalhes; duplo clique = foco; "set as root" filtra pelo nó; clicar numa aresta mostra quem chama quem.
- **Layout:** grafo composto `dagre` com `rankdir: LR` (da esquerda para a direita).

### Como o Mapa vai fazer
- Mesmo cálculo de nós (folhas) e arestas (chamadas + ancestrais), em JSON (`nodes`, `edges`, `clusters`, cada um com `eventIds`), com a disposição feita no site.
- Nós extras: rotas do Next, **tabelas**, **buckets**, **funções do banco**, **Edge Functions**, **políticas RLS** e **gatilhos** (ligados à tabela). O que vem só da estrutura do banco tem estilo "configurado".
- Começa recolhido em: Tela / Servidor do Next / Supabase; expandir mostra pastas → arquivos.

---

## 17. Trace View

### Como o AppMap faz
`appmap-js/packages/models/src/callTree/` e `components/src/components/trace/`:
- Árvore pela pilha (call empilha, return desempilha); cada nó mostra entrada (parâmetros ou requisição) e saída (retorno, status, exceção), tempo e rótulos; corpo especializado para HTTP recebido, HTTP feito e SQL.
- Nós começam recolhidos e expandem se contêm o evento selecionado/focado/destacado; link para o código (`path:lineno`).

### Como o Mapa vai fazer
Mesmo modelo (árvore com `eventId`, entrada, saída, tempo, rótulos, `location`), com corpos especializados para ação do usuário, pedido ao Supabase (operação traduzida + papel/usuário + RLS/gatilhos) e mensagem do Realtime. Valores já mascarados e encurtados.

---

## 18. Flame Graph

### Como o AppMap faz
`appmap-js/packages/components/src/components/flamegraph/*` e `src/lib/flamegraph.js`:
- Base = nome da gravação; acima, os eventos raiz; cada nível acima são os filhos (**de baixo para cima** = quem chama → quem é chamado; da esquerda para a direita = ordem).
- **Largura:** entre irmãos, proporcional a `elapsed`; eventos sem tempo válido dividem igualmente a parte proporcional à sua quantidade (`FlamegraphBranch.vue`).
- **Cor por tipo** do code object: classe/função = azul (`#4362b1`), SQL = roxo (`#9c2fba`), HTTP = `#542168`, chamada externa = amarelo (`#ebdf90`); base em verde-azulado.
- **Foco:** clicar num evento o expande para a largura toda (estados `crown`/`trunk`/`branch`/`pruned`); zoom exponencial (`largura = base × 2^(10·zoom)`); texto só se a célula tiver ≥ 50 px; tempo em ms.

### Como o Mapa vai fazer
Mesmo modelo (árvore com `eventId`, `elapsed`, `kind`), com as cores por **camada/tipo**: navegador, servidor do Next, Supabase (e dentro do Supabase, banco vs. outros serviços). Rótulo em linguagem simples: "Onde o app demorou".

---

## 19. Filtros dos diagramas

### Como o AppMap faz
`appmap-js/packages/models/src/appMapFilter.js` (`Declutter`):

| Filtro | Padrão | O que faz |
|---|---|---|
| `limitRootEvents` | ligado | só árvores cuja raiz é "comando" (HTTP recebido ou rótulos `cli.command`/`job.perform`/`message.handle`) |
| `hideMediaRequests` | ligado | esconde requisições de arquivos estáticos (extensão ou MIME) |
| `hideExternalPaths` | desligado | esconde funções fora do projeto (`node_modules`, `vendor`) |
| `hideUnlabeled` | desligado | esconde funções sem rótulo |
| `hideElapsedTimeUnder` | desligado (1 ms) | esconde o que levou menos que X ms |
| `hideName` | desligado | esconde code objects por fqid, `label:`, regex `/…/` ou prefixo `*` (filhos continuam) |
| `hideTree` | desligado | esconde os descendentes (o próprio continua) |
| `context` | desligado | mostra só os eventos ao redor de um code object (profundidade 1) |
| raiz (`rootObjects`) | — | só as subárvores de um code object |

### Como o Mapa vai fazer
Os mesmos filtros e a mesma sintaxe de casamento, com `limitRootEvents` considerando `mapa.user-action` como comando e textos em português ("Esconder código de bibliotecas", "Esconder o que levou menos de X ms", …).

---

## 20. Navie → camada LLM e arquivo de contexto

### Como o AppMap faz
O Navie usa os AppMaps como contexto de uma IA (busca de AppMaps e trechos, resumos de sequência, `appmap-js/packages/navie`).

### Como o Mapa vai fazer
- Pacote `explain`: a LLM recebe os **modelos já calculados** (sequência, dependências, árvore) e só produz nomes amigáveis e explicações, citando ids que são **validados por código** (CLAUDE.md §10.2).
- `.mapa/CONTEXT.md`: fluxos gravados, arquivos/funções, rotas, tabelas, RLS, gatilhos, Edge Functions e diagramas Mermaid, para Claude Code/Cursor.

---

## 21. Resumo das diferenças intencionais

| # | AppMap | Mapa | Motivo |
|---|---|---|---|
| 1 | Agente Node (`--require`/`--loader`) | Loader Babel no bundler (Turbopack/webpack) | Código do navegador não passa pelo Node |
| 2 | Só servidor (`condition: "node"`) | Navegador **e** servidor | É o objetivo do produto |
| 3 | meriyah + astring, TS via `ts-blank-space` | Babel com TS/JSX nativos, mantém o TS | Robustez com TS; caminho suportado no Turbopack |
| 4 | Ordem implícita (`thread_id: 0`) + buffers ALS | `parent_id` explícito + `thread_id` por fonte | Duas fontes concorrentes; navegador sem ALS |
| 5 | Sem `timestamp` | `timestamp` sempre | Juntar navegador, servidor e registros do Supabase |
| 6 | Valores sem encurtar no agente | Encurta e mascara na captura | Memória do navegador; privacidade |
| 7 | `sql_query` do driver | `http_client_request` + tradução `supabase` | Supabase é HTTP |
| 8 | Um `external-service` por host | Raias por serviço do Supabase | Público entende "login", "dados", "arquivos" |
| 9 | Gravação por requisição | Interação por ação do usuário | Unidade natural no navegador |
| 10 | Gravação remota sem limites | Start/Stop com limites | Volume previsível para leigos |
| 11 | Sequência recolhida na profundidade 3 | Recolhida na profundidade 1 | Público leigo |
| 12 | `eventUpdates` para correções | `eventUpdates` + cópia derivada com eventos sintéticos do Supabase | `eventUpdates` não cria eventos novos |
| 13 | Rótulos por config/comentário | + rótulos automáticos do Supabase | Público não rotula código |
