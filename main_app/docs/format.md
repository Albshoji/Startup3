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
  upload.json                → status do envio (Etapa 5)
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
| `sanitized` / `trimmed` | preenchidos quando o mascaramento e o encurtamento entrarem (Etapa 4) |

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
| `attribution` | `call` | `inferred` quando a ligação com o pai foi inferida, não observada (Etapa 3) |
| `labels` | `call` | rótulos do AppMap e rótulos `mapa.*`: `mapa.react-component`, `mapa.react-hook`, `mapa.event-handler`, `mapa.server-action`, `mapa.route-handler` (Etapa 2); `mapa.user-action`, `mapa.websocket` (Etapa 3) |
| `incomplete` | `return` | `true` quando a chamada ainda não tinha terminado no Stop: o coletor cria um `return` sintético (`elapsed` até o Stop; `status_code: 0` em pedidos HTTP) |
| `supabase` | `call` com `http_client_request` para o Supabase | tradução do pedido (serviço, operação, tabela, filtros), `role` e `user_id` do token, grau de certeza (Etapa 3) |

`metadata.mapa.incomplete_calls`: quantas chamadas receberam um `return` sintético.

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
  sem registrar nada).
- `POST /events?source=<fonte>`: lote de eventos brutos (JSON, `content-type: text/plain` para não
  disparar *preflight* de CORS). Fontes: `browser-<id da aba>`, `server-<pid>`. Fora de uma
  gravação, o lote é ignorado.
- CORS só para origens locais (`localhost`, `127.0.0.1`, `::1`); outras origens recebem 403.
- No Stop, o coletor ainda aceita lotes por 1 s (os gravadores enviam a cada 0,3–0,5 s).
- Contrato do código anotado com o gravador: `packages/format/src/protocol.ts`
  (`globalThis.__mapa.r/cur/bf/af/rs` e a tabela `__mapaFns` de cada arquivo).

Ações do usuário: `call` sintético com `defined_class: "Browser"`, `method_id`
`click | submit | type | navigate`, `labels: ["mapa.user-action"]`, parâmetro `target` com a
descrição do elemento.

WebSocket (Realtime): conexão como `http_client_request` `GET` com `Upgrade: websocket`
(resposta 101); cada quadro como `call` com `defined_class: "Realtime"`,
`method_id: "send" | "receive"` e o quadro em `message`.

## `interactions.json`

Lista de `Interaction` (`packages/format/src/types.ts`): `event_id`, `kind`, `target`,
`started_at`, `ended_at`, `event_count`. Até a Etapa 3 é sempre `[]` (as ações do usuário entram na Etapa 3).
