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

## Extensões dos eventos (a implementar nas Etapas 2 a 4)

| Campo | Onde | Significado |
|---|---|---|
| `timestamp` | todo evento | já existe no formato base (opcional); o Mapa **sempre** preenche |
| `layer` | `call` | `browser`, `next-server` ou `supabase` |
| `parent_id` | `call` | id da chamada que estava no topo da pilha (no formato base só existe no `return`) |
| `attribution` | `call` | `inferred` quando a ligação com o pai foi inferida (não observada) |
| `labels` | `call` | rótulos do AppMap e rótulos `mapa.*` (`mapa.user-action`, `mapa.websocket`, `mapa.react-component`, `mapa.react-hook`, `mapa.event-handler`, `mapa.server-action`) |
| `supabase` | `call` com `http_client_request` para o Supabase | tradução do pedido (serviço, operação, tabela, filtros), `role` e `user_id` do token, grau de certeza |

Ações do usuário: `call` sintético com `defined_class: "Browser"`, `method_id`
`click | submit | type | navigate`, `labels: ["mapa.user-action"]`, parâmetro `target` com a
descrição do elemento.

WebSocket (Realtime): conexão como `http_client_request` `GET` com `Upgrade: websocket`
(resposta 101); cada quadro como `call` com `defined_class: "Realtime"`,
`method_id: "send" | "receive"` e o quadro em `message`.

## `interactions.json`

Lista de `Interaction` (`packages/format/src/types.ts`): `event_id`, `kind`, `target`,
`started_at`, `ended_at`, `event_count`. Na Etapa 1 é sempre `[]`.
