# Status do projeto Mapa

> Atualizado a cada avanço. Detalhes das decisões em `docs/decisions.md`.
> Última atualização: **2026-10-06** (Etapa 4)

## Visão geral das etapas

| Etapa | O que é | Status |
|---|---|---|
| 0 | Estudo do AppMap e testes de risco | ✅ Concluída (2026-10-05) |
| 1 | Estrutura, CLI e coletor | ✅ Concluída (2026-10-06) |
| 2 | `withMapa`, plugin e `.mapa/config.json` | ✅ Concluída (2026-10-06) |
| 3 | Gravadores de navegador e servidor | ✅ Concluída (2026-10-06) |
| 4 | Start/Stop, limites e arquivo bruto | ✅ Concluída (2026-10-06) |
| 5 | Plataforma: contas, login e envio | ⏭️ Próxima |
| 6 | "Conectar Supabase" e estrutura | ⬜ |
| 7 | Processamento: refino, Supabase e registros | ⬜ |
| 8 | Modelos de diagrama (método do AppMap) | ⬜ |
| 9 | Camada LLM e contexto | ⬜ |
| 10 | Site: visualização | ⬜ |
| 11 | `mapa init` e testes ponta a ponta | ⬜ |
| 12 | Cobrança (pode ser adiada) | ⬜ |

## O que já funciona

- **`npx mapa dev`** (no app de teste): liga o app com o Mapa ativado e o coletor; mostra Next, empacotador e Node.
- **Botão flutuante** no canto da tela do app (só com o Mapa ligado): Gravar, tempo restante, uso do limite de tamanho, Parar, e aviso quando a gravação é salva ou para sozinha.
- **`npx mapa record start | stop | status`**: o mesmo pelo terminal. Grava em `.mapa/recordings/<data-hora>-<nome>/`; para sozinho em **1 minuto**, 50 000 eventos ou 12 MB (o que vier primeiro); salva se o `mapa dev` for fechado no meio.
- **Teto de 50 chamadas por função em cada ação**: laços não estouram a gravação; o arquivo diz quantas chamadas ficaram de fora.
- **`npx mapa stats`**: funções mais chamadas, tamanho e sugestão de exclusões (aplicáveis com `--aplicar`).
- Funciona com várias abas na mesma gravação.
- **As funções do app são gravadas** (navegador e servidor do Next, inclusive server actions e `proxy.ts`), com arquivo:linha, parâmetros, retorno, erros e tempo, e a ordem certa de quem chamou quem, mesmo com `await`. Funciona com Turbopack e com webpack.
- `.mapa/config.json` (opcional) escolhe o que gravar, com as mesmas regras do `appmap.yml` do AppMap. Mudanças valem ao reiniciar o `mapa dev` (ele avisa).
- O arquivo gerado é **válido no formato AppMap**, com o mapa de código (`classMap`).
- Sem o Mapa ligado, o app e o `next build` ficam idênticos aos de um projeto sem o Mapa.
- **Ações do usuário** (clique, envio de formulário, digitação, navegação, carregamento da página), **pedidos ao Supabase** traduzidos para a operação equivalente (ler/criar/alterar/apagar linhas, login, arquivos, Edge Functions) com o papel e o id de quem pediu, **requisições ao servidor do Next** ligadas ao clique que as causou, **tempo real** (Realtime), **erros** e `console`.
- Senhas, e-mails, tokens e chaves são mascarados antes de sair do navegador ou do servidor.
- `interactions.json` lista as ações do usuário de cada gravação.
- Projeto Supabase de teste montado (tabelas, regras de acesso, gatilho, bucket, Realtime, Edge Function).
- Protótipo da Etapa 0 (`spikes/etapa0/`) provou: gravação de funções no navegador e no servidor, pilha `async`, pedidos ao Supabase com quem pediu, máscara de senhas/tokens, ligação com os registros do Supabase.

## Como retomar

**Ponto exato onde parou:** Etapa 4 concluída. Nada em andamento. O próximo passo é **começar a Etapa 5** (abaixo), que precisa de decisões e contas do dono antes de começar.

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
- `packages/babel-plugin` (anota as funções), `packages/next-plugin` (`withMapa` e loader), `packages/browser-runtime` e `packages/server-runtime` (gravadores), `packages/supabase` (tradução dos pedidos ao Supabase).
- Roteiro de verificação dos cenários A–E (Etapa 3): cada cenário vira uma gravação; o app de teste usa o projeto Supabase de teste com "Confirm email" desligado (cada execução cria um usuário `mapa.teste.<hora>@example.com`).
- `examples/next16-supabase-demo` (app de teste) e `examples/next16-supabase-demo/supabase/` (migração e Edge Function do projeto de teste).
- `spikes/etapa0/` (protótipo descartável da Etapa 0: referência para as Etapas 2 a 4, especialmente `app/mapa-proto/`).
- `docs/`: `status.md` (este), `decisions.md`, `appmap-mapping.md`, `spike-report.md`, `format.md`, `referencias.md`.

## Próximo passo

**Etapa 5:** plataforma (site do Mapa em `apps/web`): contas, tabelas com RLS em todas e bucket privado (num projeto Supabase **do Mapa**, separado do projeto de teste), `mapa login`/`logout` (como `gh auth login`), envio da gravação com URL assinada, confirmação na primeira vez, reenvio com `mapa upload`.
Pronto quando: do zero, conta → login → gravação → aparece no site como "recebida"; um segundo usuário não acessa a gravação do primeiro (testado).
Antes de começar: pedir ao dono um projeto Supabase para o site do Mapa (e onde o site vai rodar).

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
| 2026-10-06 | Etapa 4 concluída: botão flutuante, limites estritos, teto por função, `mapa stats`, várias abas | `41e22a2` |
| 2026-10-06 | Etapa 3 concluída: ações do usuário, pedidos ao Supabase traduzidos, requisições ao servidor, Realtime, erros | `85d1123` |
