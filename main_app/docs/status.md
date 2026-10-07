# Status do projeto Mapa

> Atualizado a cada avanço. Detalhes das decisões em `docs/decisions.md`.
> Última atualização: **2026-10-06** (Etapa 6)

## Visão geral das etapas

| Etapa | O que é | Status |
|---|---|---|
| 0 | Estudo do AppMap e testes de risco | ✅ Concluída (2026-10-05) |
| 1 | Estrutura, CLI e coletor | ✅ Concluída (2026-10-06) |
| 2 | `withMapa`, plugin e `.mapa/config.json` | ✅ Concluída (2026-10-06) |
| 3 | Gravadores de navegador e servidor | ✅ Concluída (2026-10-06) |
| 4 | Start/Stop, limites e arquivo bruto | ✅ Concluída (2026-10-06) |
| 5 | Plataforma: contas, login e envio | ✅ Concluída (2026-10-06) |
| 6 | "Conectar Supabase" e estrutura | ✅ Concluída (2026-10-06) |
| 7 | Processamento: refino, Supabase e registros | ⏭️ Próxima |
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
- **Site do Mapa** (`apps/web`, por enquanto em `http://localhost:3300`): conta, lista de gravações, página de cada gravação ("Recebida"), download do arquivo bruto. Cada pessoa só vê as próprias gravações.
- **"Conectar Supabase"** na página de cada projeto do site: o dono autoriza o Mapa (só leitura) no Supabase; o site mostra tabelas, regras de acesso, gatilhos com código, funções, buckets e Edge Functions em português simples, e guarda um retrato da estrutura com cada gravação. "Desconectar" apaga o acesso.
- **`npx mapa login` / `logout` / `upload`**: conecta o computador à conta (código mostrado no terminal e autorizado no site); a primeira vez em cada projeto pede confirmação; depois cada Stop envia sozinho.
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

**Ponto exato onde parou:** Etapa 6 concluída. Nada em andamento. O próximo passo é a **Etapa 7** (abaixo).

**Atenção:** desde 2026-10-06 o projeto fica na pasta **`main_app/`** (o repositório Git é a pasta de cima, `Startup3/`). Todos os comandos abaixo são rodados dentro de `main_app/`.

**Para uma nova sessão do Claude Code:** o CLAUDE.md (§14) já manda ler este arquivo; basta abrir na pasta do projeto e dizer *"continue de onde parou"*.

**Ambiente (já configurado neste computador):**
- Node 24; pnpm 12.9.1 **pelo corepack**: use `corepack pnpm ...` (não há `pnpm` instalado globalmente).
- Instalar e testar: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install` · `corepack pnpm test` (compila e roda os testes de `packages/`).
- `.env` na raiz (fora do Git): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (e `SUPABASE_ACCESS_TOKEN`, a apagar).
- `apps/web/.env.local` (fora do Git): chaves do projeto Supabase **do site** (`mapa-site`), do OAuth App "Mapa" (`SUPABASE_OAUTH_CLIENT_ID/SECRET`) e a chave que criptografa os tokens (`MAPA_TOKEN_ENCRYPTION_KEY`).
- Contas reais do dono no site: `albshoji@gmail.com` (projeto `next16-supabase-demo`, já testado com o "Conectar Supabase") e `shojialbert@gmail.com`. No Supabase, o projeto de teste "Startup3" e o `mapa-site` estão na conta/organização do albshoji; a conta shojialbert só tem a organização "usp" (projeto pausado). Migrações do site: `corepack pnpm db:migrate`. Ligar o site: `cd apps/web && npx next dev --port 3300`.
- Para testar o comando contra o site local sem mexer na sua conta real: `MAPA_CONFIG_DIR=/tmp/algum-lugar MAPA_SITE_URL=http://localhost:3300 npx mapa login`.
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

**Etapa 7:** processamento no site: fila; validação; refino e corte de gravações grandes (como o AppMap); cruzamento da gravação com a estrutura do banco (grau "configurado no banco": gatilhos, regras de acesso); registros do Supabase em segunda fase como `eventUpdates` (grau "confirmado pelos registros"); situação recebida → processando → pronta (app) → pronta (com registros) / erro.
Pronto quando: cenário A mostra o perfil criado pelo gatilho ("configurado no banco"); cenário C atribui a resposta vazia à regra de acesso, citando a política; cenário D mostra os `console.log` ("confirmado pelos registros").
Observação: os registros usam a permissão Analytics do OAuth App (já concedida) e o endpoint `analytics/endpoints/logs` (coluna `source`, consultas espaçadas, atraso de até ~35 s; ver `docs/spike-report.md`, risco 6).

## Pendências e decisões em aberto

| Item | Dono | Quando |
|---|---|---|
| Confirmar com advogado o uso do formato AppMap num produto pago | Dono do projeto | Antes do lançamento |
| Nome definitivo do pacote no npm (provisório: `@mapa/cli`) | Dono do projeto | Antes de publicar |
| Testar no Next 15 (sem app Next 15 por enquanto) | Claude | Etapa 11 |
| "Confirm email" do projeto do site (hoje ligado) e página de retorno da confirmação | Dono + Claude | Antes do lançamento |
| Hospedagem e endereço de produção do site (e trocar callback/Website URL do OAuth App) | Dono | Antes dos primeiros usuários |
| Apagar a conexão de teste da conta shojialbert (organização "usp") | Dono decide | Quando quiser |
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
| 2026-10-06 | Etapa 6 concluída: Conectar Supabase (OAuth + PKCE), estrutura só leitura, retrato por gravação, desconectar | `d25d3a8` |
| 2026-10-06 | Etapa 5 concluída: site, contas, `mapa login`/`logout`/`upload`, envio, RLS testada com 2 usuários | `436583f` |
| 2026-10-06 | Etapa 4 concluída: botão flutuante, limites estritos, teto por função, `mapa stats`, várias abas | `41e22a2` |
| 2026-10-06 | Etapa 3 concluída: ações do usuário, pedidos ao Supabase traduzidos, requisições ao servidor, Realtime, erros | `85d1123` |
