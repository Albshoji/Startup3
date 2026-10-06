# Status do projeto Mapa

> Atualizado a cada avanço. Detalhes das decisões em `docs/decisions.md`.
> Última atualização: **2026-10-06** (Etapa 2)

## Visão geral das etapas

| Etapa | O que é | Status |
|---|---|---|
| 0 | Estudo do AppMap e testes de risco | ✅ Concluída (2026-10-05) |
| 1 | Estrutura, CLI e coletor | ✅ Concluída (2026-10-06) |
| 2 | `withMapa`, plugin e `.mapa/config.json` | ✅ Concluída (2026-10-06) |
| 3 | Gravadores de navegador e servidor | ⏭️ Próxima |
| 4 | Start/Stop, limites e arquivo bruto | ⬜ |
| 5 | Plataforma: contas, login e envio | ⬜ |
| 6 | "Conectar Supabase" e estrutura | ⬜ |
| 7 | Processamento: refino, Supabase e registros | ⬜ |
| 8 | Modelos de diagrama (método do AppMap) | ⬜ |
| 9 | Camada LLM e contexto | ⬜ |
| 10 | Site: visualização | ⬜ |
| 11 | `mapa init` e testes ponta a ponta | ⬜ |
| 12 | Cobrança (pode ser adiada) | ⬜ |

## O que já funciona

- **`npx mapa dev`** (no app de teste): liga o app com o Mapa ativado e o coletor; mostra Next, empacotador e Node.
- **`npx mapa record start | stop | status`**: grava em `.mapa/recordings/<data-hora>-<nome>/`; para sozinho em **1 minuto**; salva se o `mapa dev` for fechado no meio.
- **As funções do app são gravadas** (navegador e servidor do Next, inclusive server actions e `proxy.ts`), com arquivo:linha, parâmetros, retorno, erros e tempo, e a ordem certa de quem chamou quem, mesmo com `await`. Funciona com Turbopack e com webpack.
- `.mapa/config.json` (opcional) escolhe o que gravar, com as mesmas regras do `appmap.yml` do AppMap. Mudanças valem ao reiniciar o `mapa dev` (ele avisa).
- O arquivo gerado é **válido no formato AppMap**, com o mapa de código (`classMap`).
- Sem o Mapa ligado, o app e o `next build` ficam idênticos aos de um projeto sem o Mapa.
- Ainda **não** são gravados: cliques e outras ações do usuário, pedidos ao Supabase, requisições recebidas pelo servidor, WebSocket (Etapa 3).
- Projeto Supabase de teste montado (tabelas, regras de acesso, gatilho, bucket, Realtime, Edge Function).
- Protótipo da Etapa 0 (`spikes/etapa0/`) provou: gravação de funções no navegador e no servidor, pilha `async`, pedidos ao Supabase com quem pediu, máscara de senhas/tokens, ligação com os registros do Supabase.

## Como retomar

**Ponto exato onde parou:** Etapa 2 concluída. Nada em andamento. O próximo passo é **começar a Etapa 3** (abaixo).

**Atenção:** desde 2026-10-06 o projeto fica na pasta **`main_app/`** (o repositório Git é a pasta de cima, `Startup3/`). Todos os comandos abaixo são rodados dentro de `main_app/`.

**Para uma nova sessão do Claude Code:** o CLAUDE.md (§14) já manda ler este arquivo; basta abrir na pasta do projeto e dizer *"continue de onde parou"*.

**Ambiente (já configurado neste computador):**
- Node 24; pnpm 12.9.1 **pelo corepack**: use `corepack pnpm ...` (não há `pnpm` instalado globalmente).
- Instalar e testar: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install` · `corepack pnpm test` (compila e roda os testes de `packages/`).
- `.env` na raiz (fora do Git): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (e `SUPABASE_ACCESS_TOKEN`, a apagar).
- `examples/next16-supabase-demo/.env.local` (fora do Git): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Rodar o app de teste com o Mapa: `cd examples/next16-supabase-demo && npx mapa dev --port 3200` (ou `--webpack`); em outro terminal, `npx mapa record start` / `npx mapa record stop`.
- Node mínimo: 22.18 (ou 24.11), por causa do Babel 8.
- Para ver quais arquivos o plugin transformou: `MAPA_LOADER_LOG=/caminho/loader.log npx mapa dev`.
- Validar uma gravação: `node packages/format/scripts/validate-recording.mjs <arquivo.appmap.json.gz>`.

**Onde está cada coisa:**
- `packages/format` (formato, resumo de valores, máscara, regras do `config.json`, montagem do arquivo), `packages/collector` (coletor), `packages/cli` (comando `mapa`).
- `packages/babel-plugin` (anota as funções), `packages/next-plugin` (`withMapa` e loader), `packages/browser-runtime` e `packages/server-runtime` (gravadores).
- `examples/next16-supabase-demo` (app de teste) e `examples/next16-supabase-demo/supabase/` (migração e Edge Function do projeto de teste).
- `spikes/etapa0/` (protótipo descartável da Etapa 0: referência para as Etapas 2 a 4, especialmente `app/mapa-proto/`).
- `docs/`: `status.md` (este), `decisions.md`, `appmap-mapping.md`, `spike-report.md`, `format.md`, `referencias.md`.

## Próximo passo

**Etapa 3:** gravadores de navegador e servidor: ações do usuário (clique, envio, navegação, erros), `fetch`/XHR, WebSocket (Realtime), requisições recebidas pelo servidor, `traceparent` só na mesma origem, papel/id do usuário do Supabase, tradução dos pedidos ao Supabase e rótulos.
Pronto quando: os cenários A a E registram os pedidos ao Supabase traduzidos e rotulados, o papel/id de cada pedido, as mensagens do Realtime e o erro proposital; nenhum pedido ao Supabase recebe `traceparent`.
Observação: os cenários com login (A, B com sucesso, E) vão precisar de cadastro/login no app de teste.

## Pendências e decisões em aberto

| Item | Dono | Quando |
|---|---|---|
| Confirmar com advogado o uso do formato AppMap num produto pago | Dono do projeto | Antes do lançamento |
| Nome definitivo do pacote no npm (provisório: `@mapa/cli`) | Dono do projeto | Antes de publicar |
| Testar no Next 15 (sem app Next 15 por enquanto) | Claude | Etapa 11 |
| Apagar o token pessoal `sbp_` do Supabase e tirar do `.env` | Dono do projeto | Agora (não é mais necessário) |
| Conferir se o repositório no GitHub está privado | Dono do projeto | Agora |

## Histórico

| Data | Marco | Commit |
|---|---|---|
| 2026-10-05 | Etapa 0 parte A: índice das referências e mapeamento AppMap → Mapa | `a2aa20f` |
| 2026-10-05 | Etapa 0 parte B: riscos 1, 2 e 4 | `9eb0b34` |
| 2026-10-05 | Etapa 0 parte B: riscos 3, 5 e 6 (Supabase de teste) | `fd4e336`, `46710b8` |
| 2026-10-05 | Etapa 0 concluída; limites decididos (1 min) | `a86e7f7` |
| 2026-10-06 | Etapa 1 concluída: monorepo, CLI `mapa`, coletor | `f75cd0a` |
| 2026-10-06 | Projeto movido para `main_app/` | `e46e083` |
| 2026-10-06 | Etapa 2 concluída: `withMapa`, plugin Babel, gravadores de funções, `.mapa/config.json` | `f3ac7e6` |
