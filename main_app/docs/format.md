# Formato do arquivo bruto do Mapa

> Base: especificação AppMap **v1.14** (`referencias/appmap/README.md`). Tipos em
> `packages/format/src/types.ts`. Extensões só **acrescentam** campos: um leitor de AppMap
> que ignore campos desconhecidos continua lendo o arquivo (o validador do AppMap trata todo
> objeto como extensível).

## Arquivos de uma gravação (CLAUDE.md §8 e §9.4)

```
.mapa/recordings/<AAAA-MM-DD_HH-mm-ss>[-<nome>]/
  recording.appmap.json.gz   → arquivo bruto (gzip), mascarado e válido
  interactions.json          → índice das ações do usuário (lista de Interaction)
  upload.json                → status do envio: {status: "enviada"|"erro", id, url, message, at}
```

No site, mais tarde: `supabase-schema.json` (retrato da estrutura do banco) e
`recording.enriched.appmap.json` (cópia derivada com eventos sintéticos do Supabase; ver
`docs/appmap-mapping.md` §11).

## Versão

- O arquivo declara `"version": "1.14"`.
- O validador do AppMap (`@appland/appmap-validate` 2.5.1, usado **só nos testes**) conhece o
  esquema até **1.13.1** e confere o valor de `version`. Como a 1.14 só acrescenta metadados
  opcionais (`trimmed`, `sanitized`), os testes validam uma cópia com `version: "1.13.1"`
  (`packages/format/scripts/validate-recording.mjs`).

## `metadata`

Campos do formato base que o Mapa preenche:

| Campo | Valor |
|---|---|
| `app` | `name` do `package.json` do app |
| `name` | nome dado à gravação (`npx mapa record start <nome>`), se houver |
| `language` | `{ name: "javascript", engine: "Node.js", version }` |
| `frameworks` | versões instaladas de `next`, `react`, `@supabase/supabase-js`, `@supabase/ssr` |
| `client` | `{ name: "mapa", url, version }` |
| `recorder` | `{ type: "remote", name: "mapa" }` (Start/Stop = gravação remota do AppMap) |
| `git` | `repository` (sem usuário/senha embutidos na URL), `branch`, `commit`, `status` |
| `trimmed` | `{version, max_length: 100}`: todo valor capturado foi cortado em 100 caracteres |
| `sanitized` | **não** usado: na especificação significa trocar *todo* valor por um código, o que o Mapa não faz (ele mascara só o que é sensível) |

### Extensão `metadata.mapa`

| Campo | Significado |
|---|---|
| `started_at`, `stopped_at` | início e fim da gravação (ISO 8601) |
| `stopped_by` | `user` (Stop), `time-limit`, `event-limit`, `size-limit`, `shutdown` (o `mapa dev` foi fechado) |
| `limits` | limites em vigor: `maxSeconds`, `maxEvents`, `maxMegabytes`, `maxCallsPerFunctionPerAction` |

## Extensões dos eventos

| Campo | Onde | Significado |
|---|---|---|
| `timestamp` | todo evento | já existe no formato base (opcional); o Mapa **sempre** preenche (época, em segundos) |
| `layer` | `call` | `browser`, `next-server` ou `supabase` |
| `attribution` | `call` | `inferred` quando a ligação com o pai foi inferida, não observada (ver abaixo) |
| `labels` | `call` | rótulos do AppMap (`security.authentication`, `security.logout`, `dao.materialize`, `access.public`, `log`, os de `// @label` e do `config.json`) e rótulos `mapa.*`: `mapa.user-action`, `mapa.error`, `mapa.websocket`, `mapa.react-component`, `mapa.react-hook`, `mapa.event-handler`, `mapa.server-action`, `mapa.route-handler` |
| `remote_parent_id` | `call` com `http_server_request` | id da chamada, em outra thread, que causou esta (o `fetch` do navegador por trás de uma requisição ao servidor). Exato pelo `traceparent`; para o carregamento de uma página, inferido por caminho e horário (`attribution: "inferred"`) |
| `supabase` | `call` com `http_client_request` para o Supabase | tradução do pedido (abaixo) |
| `realtime` | `call` `Realtime.send`/`receive` | estrutura do quadro do Realtime (abaixo) |
| `incomplete` | `return` | `true` quando a chamada ainda não tinha terminado no Stop: o coletor cria um `return` sintético com `elapsed` até o Stop |
| `error` | `return` com `http_client_response` | o pedido falhou sem resposta (erro de rede, cancelado): `{class, message}` |

`metadata.mapa.incomplete_calls`: quantas chamadas receberam um `return` sintético.

### Pedidos HTTP sem status

O esquema exige `status_code` entre 100 e 599 em toda resposta HTTP. Quando não há status (erro
de rede, pedido cancelado, ou ainda esperando no Stop), o Mapa grava **599** (código informal de
"erro de rede") **e** marca o `return` com `error` ou `incomplete`, que dizem o que de fato houve.

### Chamadas sintéticas (sem arquivo)

Ações do usuário, erros, `console` e quadros do Realtime são `call` de função com um `path`
próprio do Mapa (`mapa:browser`, `mapa:console`, `mapa:realtime`), sem `lineno`, e entram no
`classMap` num pacote com esse nome. Motivo: o validador exige que toda chamada de função esteja
no `classMap` com o mesmo caminho.

| `defined_class` | `method_id` | O que é |
|---|---|---|
| `Browser` | `click`, `submit`, `type`, `navigate` | ação do usuário (`mapa.user-action`). Parâmetros: `target` (descrição do elemento, **nunca** o valor de um campo) e, em `navigate`, `url`. Clicar no botão de envio de um formulário é uma ação só (o `submit` entra no `click`). Teclas no mesmo campo com menos de 1 s entre elas são uma ação `type` só |
| `Browser` | `error`, `unhandledrejection` | erro não tratado na página (`mapa.error`), com `exceptions` no `return` |
| `console` | `log`, `info`, `warn`, `error`, `debug` | saída do `console` feita **dentro** de uma função gravada (rótulo `log`); mensagens do próprio Next ficam de fora |
| `Mapa` | `omitted` | chamadas deixadas de fora pelo teto por função (`mapa.omitted`, caminho `mapa:recorder`). Parâmetros: `function` (`Classe.metodo`), `location` (`arquivo:linha`), `omitted_calls`. Fica onde a primeira chamada omitida estaria (sob o ancestral gravado mais próximo) |
| `Realtime` | `send`, `receive` | quadro do WebSocket do Realtime, filho da conexão (`http_client_request` `GET` com resposta 101). Quadros de "heartbeat" ficam de fora |

Uma ação termina quando, por 500 ms, não há nenhum pedido pendente ligado a ela; seu `elapsed`
vai até a última atividade. O carregamento da página (`navigate` com alvo `carregar …`) começa no
início da navegação (`performance.timeOrigin`).

### Ligações inferidas (`attribution: "inferred"`)

- Funções que rodam sem pilha durante uma ação aberta (re-renderizações do React, quadros do
  Realtime, `useEffect` no carregamento) ficam sob a ação mais recente.
- Um pedido feito por código interno de biblioteca quando só a ação está na pilha fica sob a
  função do app que estava esperando (`await`) naquela ação.
- A requisição que serviu uma página fica ligada ao carregamento daquela página.

### Extensão `supabase` (tradução do pedido, `packages/supabase`)

| Campo | Exemplo |
|---|---|
| `service` | `rest`, `auth`, `storage`, `functions`, `realtime`, `graphql` |
| `operation` | `select`, `count`, `insert`, `upsert`, `update`, `delete`, `rpc`; `signup`, `login`, `refresh`, `logout`, `get_user`…; `upload`, `download`, `remove`, `list`, `sign_url`…; `invoke`; `connect` |
| `table`, `function`, `bucket`, `object` | `items`, `calcular_total`, `avatars`, `<id>/avatar.png` |
| `columns`, `filters`, `order`, `limit`, `offset`, `on_conflict`, `single` | do formato PostgREST; valores dos filtros mascarados |
| `write_columns`, `rows` | colunas escritas (só os nomes) e quantidade de linhas enviadas |
| `sql` | forma SQL legível, **derivada** (nunca vista no banco): `select id,nome from items where owner_id = 42 order by id asc` |
| `role`, `user_id`, `key` | papel e id do usuário, lidos **só** de `role`/`sub` do token (ou da chave); `key`: `jwt`, `publishable`, `secret` |
| `certainty` | `recorded` (veio da execução); `logs` e `schema` na Etapa 7 |

O identificador do pedido no Supabase (`sb-request-id`, só no servidor: o CORS o esconde do
navegador) fica nos cabeçalhos da resposta (`http_client_response.headers`).

### Extensão `realtime`

`{direction, topic, event, changes: [{event, schema, table, filter}], status}`: só a estrutura do
quadro (canal, tipo, tabelas assinadas ou alteradas); valores das linhas nunca são copiados aqui. O
quadro em si vai mascarado e encurtado no parâmetro `frame`.

### Exceções

`exceptions[]` sempre com `object_id` (exigido pelo esquema): o mesmo erro, propagando por várias
funções, mantém o mesmo número. O coletor renumera por fonte para que erros de abas e do servidor
nunca compartilhem um número.

### `parent_id` só no transporte (decisão da Etapa 2)

O esquema do AppMap **proíbe** `parent_id` em eventos `call`
(`definitions/call/properties/parent_id: false` no `@appland/appmap-validate`). Por isso:

1. os gravadores mandam ao coletor cada `call` **com** `parent_id` (o pai lógico, observado pelo
   `AsyncLocalStorage` no servidor e pela marcação de `await` no navegador), numerando os eventos
   por fonte (cada aba e o servidor contam por conta própria);
2. no Stop, o coletor monta a árvore pelos `parent_id`, escreve cada subárvore de forma contígua
   (raízes em ordem de `timestamp`, filhos em ordem de chamada), **renumera** os ids (o validador
   exige ids crescentes e ordem FIFO por `thread_id`) e **remove** o `parent_id` dos `call`
   (`packages/format/src/linearize.ts`).

O arquivo final é lido como qualquer AppMap: a árvore sai da ordem dos eventos em cada thread.

### `thread_id`

Atribuído pelo coletor, na ordem em que cada linha de execução aparece: uma por aba do navegador;
no servidor, cada chamada sem pai (por exemplo, o começo de uma requisição) abre uma linha nova e
seus filhos ficam nela.

### Campos que o esquema proíbe (atenção para a Etapa 3)

`elapsed` em `call`; `return_value`/`exceptions` em eventos com `http_client_response` ou
`http_server_response` (o corpo da resposta vai **dentro** de `http_client_response.return_value`);
`defined_class`/`method_id` em eventos com `http_client_request`/`http_server_request`.

## Protocolo gravador → coletor

- `GET /record`: os gravadores consultam a cada 1 s se há gravação (sem gravação, as funções rodam
  sem registrar nada). Ao carregar a página, o gravador do navegador grava **provisoriamente** até a
  primeira resposta do coletor (descarta tudo se não houver gravação), para não perder o que roda
  logo no carregamento.
- `POST /events?source=<fonte>`: lote de eventos brutos (JSON, `content-type: text/plain` para não
  disparar *preflight* de CORS). Fontes: `browser-<id da aba>`, `server-<pid>`. Fora de uma
  gravação, o lote é ignorado.
- CORS só para origens locais (`localhost`, `127.0.0.1`, `::1`); outras origens recebem 403.
- No Stop, o coletor ainda aceita lotes por 1 s (os gravadores enviam a cada 0,3–0,5 s); nesse
  intervalo `GET /record` responde `saving: true`.
- `GET /record` também traz `bytes` (tamanho recebido) e `last` (a última gravação salva: motivo
  da parada, eventos, pasta), usados pelo botão flutuante. `POST`/`DELETE /record` também podem vir
  da página (CORS com *preflight* para origens locais).
- Limites estritos: um lote que passa do limite de eventos ou de MB é cortado no ponto do limite;
  as chamadas cortadas no meio recebem o `return` sintético `incomplete`.
- Antes de escrever, uma última varredura (`packages/format/src/finalize.ts`) mascara e corta de
  novo todos os valores e remove cabeçalhos secretos (rede de segurança).
- Contrato do código anotado com o gravador: `packages/format/src/protocol.ts`
  (`globalThis.__mapa.r/cur/bf/af/rs` e a tabela `__mapaFns` de cada arquivo).

Requisições HTTP: `http_client_request` com `url` **sem** a query string, a query e o corpo
(mascarado, até 100 caracteres) em `message`, e só cabeçalhos úteis (`content-type`, `prefer`,
`traceparent`…; nunca `authorization`, `apikey` ou `cookie`). A resposta vai em
`http_client_response` (`status_code`, cabeçalhos úteis, corpo resumido em `return_value`).
Requisições recebidas pelo servidor: `http_server_request` (`path_info`, `protocol`, cabeçalhos
úteis, query em `message`) e `http_server_response` (status e `content-type`; o corpo não é
gravado).

## `interactions.json`

Lista de `Interaction` (`packages/format/src/types.ts`): `event_id`, `kind`, `target`,
`started_at`, `ended_at`, `event_count`. `event_count` inclui os eventos das requisições ao servidor causadas pela ação (`remote_parent_id`).
