# Mapa — o "AppMap do frontend" para apps Next.js + Supabase

> **Como usar este arquivo:** coloque-o na raiz do repositório novo do projeto com o nome `CLAUDE.md`. O Claude Code lê esse arquivo automaticamente em toda sessão. Para começar, abra o Claude Code na pasta e diga: **"Leia o CLAUDE.md e execute a Etapa 0."** Avance uma etapa por vez.

---

## 1. O que estamos construindo

O **AppMap** grava a execução de backends e gera diagramas a partir dessa gravação. O **Mapa** faz o mesmo para o que o AppMap não cobre no nosso público: **o frontend (navegador), o servidor do Next.js e o Supabase**.

O Mapa tem duas partes:

1. **Ferramenta local (`npx mapa`)**, que roda no computador do usuário. Grava o que acontece dentro de um app **Next.js + Supabase** enquanto ele é usado: cliques, funções do navegador, funções do servidor do Next, pedidos ao Supabase e as respostas. Como no AppMap: liga o app pelo Mapa, aperta **Start**, usa o app, aperta **Stop**.
2. **Site do Mapa (plataforma web)**, onde o usuário tem conta. No Stop, a gravação é enviada para a conta dele. O usuário também pode **conectar o projeto Supabase** dele ("Conectar Supabase"), para o Mapa enxergar o que acontece dentro do Supabase.

A partir de um **arquivo com todos os dados brutos** (seção 8), o site gera:
- **diagramas de cada ação gravada**, com o **mesmo método de criação do AppMap** (quais diagramas existem, o que cada um contém, como agrupar e filtrar), mas **apresentados para desenvolvedores júnior e pessoas não técnicas**;
- **explicações em português simples**, geradas por uma LLM sobre os dados brutos;
- um **arquivo de contexto** que as IAs que o usuário já usa (Claude Code, Cursor etc.) podem ler para entender a arquitetura real do app;
- o **histórico** de gravações por projeto.

O site será cobrado por **assinatura mensal** (a cobrança pode entrar depois dos primeiros usuários; ver Etapa 12).

**Público:** solo founders e devs indie que constroem com IA (vibe coders), sem muita base técnica. A stack deles é, na grande maioria, **Next.js + Supabase**. Este é o único foco do MVP.

---

## 2. Princípio central: o AppMap é a base de tudo

**Regra de ouro:** sempre que houver dúvida sobre como projetar algo, descubra **como o AppMap faz para o backend** e faça **o equivalente para o frontend, o servidor do Next e o Supabase**. Só se afaste do AppMap quando houver um motivo concreto (o navegador funciona diferente, o Supabase é um serviço externo, o público é leigo), e registre o motivo em `docs/decisions.md`.

### 2.1 Mapa de equivalências (preencher e aprofundar na Etapa 0)

| No AppMap (backend) | No Mapa (frontend + Next + Supabase) |
|---|---|
| **Agente** da linguagem (ex.: `appmap-node`), que altera o código ao carregar, sem mexer nos arquivos | **Sensores do Mapa**: plugin Babel aplicado pelo bundler do Next + gravadores de navegador e de servidor |
| `appmap.yml` (`packages` com `path` e `exclude` por arquivo/função) | `.mapa/config.json` com a **mesma semântica** (caminhos incluídos, exclusões por arquivo, função ou método) |
| **Gravação remota** (Start/Stop por HTTP com o app rodando) | **Start/Stop** pelo botão flutuante e pelo terminal |
| **Gravação por requisição** (uma gravação por requisição HTTP recebida) | **Gravação por ação do usuário** (uma "interação" por clique/envio, até não haver mais atividade) |
| **Gravação de processo** (do início ao fim) | Sessão inteira entre Start e Stop |
| **Formato AppMap** (`metadata`, `classMap`, `events` de chamada/retorno, `http_server_request`, `http_client_request`, `sql_query`, `message`, `labels`, `eventUpdates`) | **O mesmo formato**, com extensões para ações do usuário, WebSocket e Supabase (seção 8) |
| `sql_query` (banco acessado pelo próprio backend) | Pedidos ao Supabase como `http_client_request`, **traduzidos** para a operação equivalente no banco (seção 7) |
| **Rótulos** (`security.authentication`, `security.authorization`, `log`, `secret`, `dao.materialize`…) | **Os mesmos rótulos** aplicados a funções, pedidos ao Supabase e regras de acesso, mais rótulos próprios quando faltar um equivalente |
| `eventUpdates` (enriquecer eventos depois de gravados) | Enriquecer os eventos com os **registros do Supabase**, que chegam minutos depois |
| **Estatísticas** e **refino** (`stats`, exclusão das funções mais chamadas, corte automático de gravações grandes) | O mesmo processo, aplicado no CLI e no site (seção 9.3) |
| **Diagramas**: Dependency Map, Trace View, Sequence Diagram, Flame Graph (seção 10) | **Os mesmos diagramas**, com o mesmo método de construção, e uma camada de linguagem simples por cima |
| **Análises** (ex.: consultas N+1, falta de autenticação) | Evolução futura: as mesmas ideias aplicadas ao Supabase (consultas repetidas em laço, tabela sem regra de acesso) |
| **Navie** (IA que usa os dados do AppMap como contexto) | **Camada LLM** do Mapa e **arquivo de contexto** para as IAs do usuário |

### 2.2 Como usar o AppMap como base (e o limite da licença)

- **Pode e deve:** ler a documentação, a especificação do formato e o **código** do AppMap (`referencias/`) para entender **como** eles resolvem cada problema (instrumentação, formato, filtros, construção dos diagramas, estatísticas) e reproduzir **a mesma abordagem**.
- **Não pode:** copiar ou colar código do AppMap no Mapa. A licença do `appmap-node` é **MIT + "Commons Clause"**, que proíbe vender um produto ou serviço cujo valor venha inteira ou substancialmente da funcionalidade do software. O Mapa é pago. Implemente sempre com **código nosso**, seguindo o mesmo desenho.
- Antes de usar qualquer pacote do AppMap como dependência (ex.: validador), leia o `LICENSE` e pergunte.
- O formato AppMap é seguido por compatibilidade. Antes do lançamento comercial, o dono do projeto vai confirmar com um advogado; registre essa pendência em `docs/decisions.md`.

---

## 3. Escopo do MVP

### Dentro do escopo
- Apps **Next.js 15 e 16**, App Router, **React 19**, TypeScript ou JavaScript.
- **Turbopack** (padrão do Next 16) como alvo principal; **webpack** (`next dev --webpack`) como alternativa.
- Node.js **22 e 24**.
- Somente **modo de desenvolvimento** (`next dev`), no computador do usuário.
- **Supabase hospedado** (supabase.com), acessado por `@supabase/supabase-js` / `@supabase/ssr`, do navegador e do servidor do Next.
- Site: contas, login pelo comando, envio de gravações, "Conectar Supabase", processamento, diagramas, explicações. Cobrança no fim.

### Fora do escopo (não implementar agora)
- Lovable, Bolt, apps hospedados, modo de produção.
- Outras stacks (Vue, Svelte, Firebase, backends próprios em outras linguagens).
- Acesso direto ao Postgres por drivers (`pg`, Prisma, Drizzle) sem a biblioteca do Supabase.
- Supabase local (`supabase start`) e self-hosted.
- Função a função **dentro** das Edge Functions (no MVP: chamada, resultado e `console.log`).
- pgAudit; tarefas agendadas e webhooks sem relação com a ação gravada.
- Análises automáticas no estilo das regras do AppMap (evolução).
- Interface pedagógica completa (mapa de fases, árvore de pré-requisitos).

---

## 4. Experiência do usuário

1. **Conta** no site do Mapa.
2. **Conectar Supabase (uma vez por projeto):** botão no site → autorizar o Mapa no Supabase → escolher o projeto (recomendar o de **desenvolvimento**). Acesso **só de leitura** (estrutura do banco e registros). Pode ser desfeito ("Desconectar"). Sem conectar, o Mapa funciona, mas sem regras de acesso, gatilhos e o que acontece dentro do Supabase.
3. **Login no computador (uma vez):** `npx mapa login` (fluxo "device code", como `gh auth login`). Token guardado fora do projeto.
4. **Instalação no projeto (uma vez):** `npx mapa init`
   - mostra o que vai mudar e **pede confirmação**;
   - adiciona o pacote do Mapa como dependência de desenvolvimento;
   - envolve a configuração: `export default withMapa(nextConfig)` em `next.config.(js|mjs|ts)`;
   - cria `.mapa/config.json` (equivalente ao `appmap.yml`);
   - detecta a URL do Supabase (ex.: `NEXT_PUBLIC_SUPABASE_URL`) e associa ao projeto no site;
   - adiciona `.mapa/` ao `.git/info/exclude`.
   - `withMapa` **não faz nada** sem a variável `MAPA`. O app fica idêntico fora do Mapa, inclusive em produção.
5. **Uso diário:** `npx mapa dev` (no lugar de `npm run dev`): liga o app com `MAPA=1` e o **coletor local**.
6. **Gravar:** botão flutuante no navegador (só em dev, só com `MAPA=1`): **Start**, indicador de gravação, tempo restante, uso do limite de tamanho, **Stop** (ou parada automática por limite). Também pelo terminal: `npx mapa record start|stop`.
7. **Envio:** no Stop, o arquivo bruto completo é preparado (seção 9) e enviado à conta. Confirmação na primeira vez. Sem login, fica só local em `.mapa/recordings/`.
8. **No site:** a gravação aparece como "processando". Primeiro ficam prontos os diagramas e explicações da parte do app; a parte vinda dos registros do Supabase chega **alguns minutos depois** e atualiza tudo.
9. **Contexto para outras IAs:** `npx mapa context` baixa o contexto do projeto para `.mapa/CONTEXT.md`.

---

## 5. Arquitetura

```
COMPUTADOR DO USUÁRIO                                      NUVEM
┌──────────────────────────────┐                          ┌──────────────────────────────────┐
│ Navegador                    │                          │ Site do Mapa (Next.js+Supabase)  │
│ - código anotado (plugin)    │                          │ - contas, login do CLI           │
│ - gravador: cliques, rotas,  │                          │ - "Conectar Supabase" (OAuth)    │
│   fetch, WebSocket, erros    │                          │ - recebe o arquivo bruto         │
│ - botão Start/Stop           │                          │ - processamento:                 │
└──────────────┬───────────────┘                          │   refino → tradução Supabase →   │
               │ eventos                                   │   estrutura + registros →        │
               ▼                                           │   modelos de diagrama (AppMap) → │
┌──────────────────────────────┐   arquivo bruto completo │   camada LLM → contexto          │
│ Coletor local do Mapa        │ ───────────────────────▶ │ - visualização                   │
│ - Start/Stop, limites        │                          └───────────────┬──────────────────┘
│ - junta navegador + servidor │                                          │ OAuth (só leitura)
│ - refino, mascara, comprime  │                                          ▼
└──────────────▲───────────────┘                          ┌──────────────────────────────────┐
               │ eventos                                   │ Projeto Supabase do usuário      │
┌──────────────┴───────────────┐   pedidos/respostas      │ - estrutura do banco (leitura)   │
│ Servidor Next.js do usuário  │ ───────────────────────▶ │ - registros (logs)               │
│ - código anotado (plugin)    │  (também do navegador)    │ - API, Auth, Storage, Edge Fn,   │
│ - gravador de servidor       │                          │   Realtime                       │
└──────────────────────────────┘                          └──────────────────────────────────┘
```

### Estrutura do monorepo
**pnpm workspaces** + **TypeScript** (ajuste se tiver motivo e registre):

```
apps/
  web/              → site: contas, API, Conectar Supabase, processamento, visualização
packages/
  cli/              → comando `mapa` (login, init, dev, record, upload, context, stats, uninstall)
  next-plugin/      → withMapa(): registra o plugin (navegador e servidor) e injeta os gravadores
  babel-plugin/     → anota as funções do código do usuário (equivalente ao agente do AppMap)
  browser-runtime/  → gravador do navegador + botão flutuante
  server-runtime/   → gravador do servidor do Next
  collector/        → servidor local: Start/Stop, limites, junção, refino, mascaramento, envio
  format/           → formato (compatível com AppMap), validação, estatísticas, refino
  supabase/         → tradução dos pedidos, leitura da estrutura, consulta aos registros
  diagrams/         → modelos de diagrama a partir do arquivo bruto (método do AppMap)
  explain/          → camada LLM: linguagem simples, explicações, contexto
supabase/           → banco, RLS e armazenamento DO SITE DO MAPA (não confundir com o do usuário)
examples/
  next16-supabase-demo/ → app de teste (seção 11)
referencias/        → repositórios do AppMap e outros, só leitura (seção 13), fora do Git
docs/
  appmap-mapping.md → como o AppMap faz cada coisa e como o Mapa faz o equivalente (Etapa 0)
  decisions.md      → decisões e motivos
  format.md         → formato do arquivo bruto e extensões
  spike-report.md   → resultado dos testes de risco
```

---

## 6. Como o app do usuário é gravado (equivalente ao agente do AppMap)

Estude primeiro **como o `appmap-node` instrumenta o código** (carregamento, quais funções envolve, o que registra em cada chamada, como trata `async`, como aplica `packages`/`exclude`) e reproduza a mesma lógica, adaptada ao bundler do Next.

**Funções do código do usuário (navegador e servidor):** plugin Babel nosso, aplicado pelo `withMapa` através de `turbopack.rules` (loader do tipo webpack; o `babel-loader` é suportado pelo Turbopack) e da configuração equivalente para webpack.
- Duas regras: código do **navegador** (condição `browser`) e do **servidor** (condição "não `browser`"). Ambas excluem `foreign` (`node_modules` e internos do Next).
- Respeitar `.mapa/config.json` (inclusões e exclusões), como o `appmap.yml`.
- Para cada função (declarações, arrow functions, métodos, `async`, componentes React, server actions, handlers de rota), registrar o mesmo que o AppMap registra num evento de chamada e de retorno: classe/módulo, nome, arquivo, linha, parâmetros (nome, tipo, valor resumido), valor de retorno, exceções, tempo.
- **Pilha assíncrona:** no **servidor**, `AsyncLocalStorage` do Node. No **navegador** não há solução nativa (a proposta AsyncContext ainda está no Stage 2; o zone.js não intercepta `async/await` nativo): o plugin deve **marcar os pontos de `await`** para salvar e restaurar a pilha.
- Preservar source maps. Não depender de `_debugSource` do React (removido no React 19).
- **Nunca** criar `babel.config.js` no projeto do usuário (no modo webpack isso desliga o SWC do Next).
- **Middleware/proxy do Next** (usado pelo Supabase para a sessão): há relato de limitação de loaders com Turbopack. Testar; se não der para anotar, registrar ao menos que rodou.
- Referências de encaixe: **LocatorJS** (`@locator/webpack-loader`) e **`babel-plugin-istanbul`**.

**Gravador do navegador:** equivalente ao que o AppMap faz com requisições, adaptado ao navegador.
- Ações do usuário: clique, envio de formulário, navegação (inclusive rotas do Next), erros não tratados.
- `fetch`/XHR como `http_client_request`/`http_client_response`: método, URL, cabeçalhos relevantes, corpos resumidos, status, duração.
- WebSocket (Realtime do Supabase): conexão, canais, mensagens resumidas.
- `traceparent` (W3C) **só** em requisições para a **mesma origem** do app. Nunca para o Supabase ou outras origens (dispara preflight e pode quebrar a requisição).
- O botão e o gravador não aparecem na gravação. Botão isolado do CSS do app (Shadow DOM).

**Gravador do servidor do Next:** equivalente ao `http_server_request` do AppMap.
- Requisições recebidas (rota, método, status, duração), ligadas ao `traceparent` do navegador.
- `fetch` de saída (por onde o `supabase-js` fala com o Supabase a partir do servidor).
- Avaliar na Etapa 0 se vale aproveitar os registros que o próprio Next gera via OpenTelemetry.

---

## 7. Supabase: o que gravamos e como

### 7.1 Termos
- **Pedido (requisição):** a mensagem que o app envia ao Supabase pedindo algo.
- **Resposta (retorno):** o que o Supabase devolve (dados, sucesso ou erro).

### 7.2 O que sai só da execução do código (sem acesso ao Supabase)
- As funções do usuário que rodaram e **qual delas fez cada pedido** ao Supabase.
- Cada pedido e sua resposta, **traduzidos** para a operação equivalente (como o AppMap mostra `sql_query`):

| Endereço | Operação equivalente | Rótulo AppMap sugerido |
|---|---|---|
| `/rest/v1/<tabela>` + `GET`/`POST`/`PATCH`/`DELETE`, com `select=`, `id=eq.5`, `order=`, `limit=` | Ler / criar / alterar / apagar linhas, com filtros (formato PostgREST) | `dao.materialize` (leituras) |
| `/rest/v1/rpc/<função>` | Chamada de função do banco | — |
| `/auth/v1/...` | Cadastro, login, renovação de sessão, logout | `security.authentication`, `security.logout` |
| `/storage/v1/object/...` | Envio, leitura ou remoção de arquivo | — |
| `/functions/v1/<nome>` | Chamada de Edge Function (serviço externo) | — |
| WebSocket do Realtime | Assinatura de canal e mensagens | — |

- **Quem pediu:** do token de login enviado em cada pedido, ler **só** o papel (`anon`/`authenticated`) e o id do usuário (`sub`), antes de mascarar o resto.
- Erros devolvidos pelo Supabase, com código e mensagem.

### 7.3 O que só se descobre dentro do Supabase

| O que falta | Exemplo | Como obter (MVP) |
|---|---|---|
| **Regras de acesso (RLS)** de tabelas e arquivos | "Voltou vazio porque a regra só mostra os itens do próprio dono" | Leitura da estrutura + papel e id do usuário (rótulo `security.authorization`) |
| **Gatilhos** | "O cadastro também criou seu perfil (`handle_new_user`)" | Leitura da estrutura |
| **Funções do banco** | O que `calcular_total` faz | Leitura da estrutura (código da função) |
| **Cascatas e chaves estrangeiras** | "Apagar o usuário apagou os itens dele" | Leitura da estrutura |
| **Webhooks do banco** | "Inserir um item avisa um serviço externo" | Leitura da estrutura |
| **Dentro das Edge Functions** | O que a função fez antes de responder | Registros (`console.log`) + código em `supabase/functions/<nome>`, se existir |
| **Detalhes do login** | "Foi enviado um e-mail de confirmação" | Registros de autenticação |
| **Erros detalhados do banco** | Por que um comando falhou | Registros do banco |

**Grau de certeza** de cada informação (aparece nos diagramas e explicações):
- **Confirmado pela gravação** (veio da execução do código);
- **Confirmado pelos registros** (apareceu nos registros do Supabase);
- **Configurado no banco** (só da estrutura: diz o que **deveria** acontecer).

### 7.4 "Conectar Supabase" (OAuth)
Processo oficial do Supabase: o Mapa é registrado como **OAuth App** e usa a **Management API** em nome do usuário.
1. Redirecionar para `https://api.supabase.com/v1/oauth/authorize` (com PKCE).
2. Trocar o código por **access token + refresh token** em `POST https://api.supabase.com/v1/oauth/token`.
3. Usuário escolhe o projeto (o `mapa init` sugere pela URL detectada).
4. Tokens **só no servidor do site**, criptografados. Nunca no CLI, no navegador ou em gravações.
- Pedir o **mínimo de permissões** (definidas ao criar o OAuth App): consulta só de leitura, metadados do banco, lista de Edge Functions, registros. Documentar a escolha.
- **Atenção humana necessária:** criar e publicar o OAuth App exige ações no painel do Supabase. Na etapa correspondente, **pare e peça ao usuário**, com passo a passo, e receba `client_id`/`client_secret` como variáveis de ambiente.

### 7.5 Leitura da estrutura do banco
- Usar **só** o endpoint de consulta somente leitura da Management API (`POST /v1/projects/{ref}/database/query/read-only`, em beta). **Nunca** o endpoint com escrita.
- Ler, pelos catálogos do Postgres: tabelas e colunas, chaves estrangeiras (cascatas), **políticas RLS** (inclusive `storage.objects`), **gatilhos** com o código das funções, funções do banco (RPC), tabelas com Realtime, webhooks do banco, buckets.
- Guardar um **retrato da estrutura com cada gravação** (equivalente ao `classMap` do lado do banco).
- Complemento sem conexão: migrações em `supabase/migrations` (muitos usuários criam tabelas pelo painel, então podem não existir).

### 7.6 Registros (logs) do Supabase
- `GET /v1/projects/{ref}/analytics/endpoints/logs`, com SQL **ClickHouse** numa tabela única `logs`, filtrando a fonte pela coluna `source` (a documentação do Supabase diz `source_name`, mas a API real recusa esse campo; verificado na Etapa 0) e lendo os campos em `log_attributes['…']`. O endereço antigo `logs.all` **foi removido em 23/09/2026**. A API recusa consultas seguidas (`Too Many Requests`): consultar com intervalo.
- Fontes: autenticação, API (edge), Edge Functions (rede e `console.log`), banco, armazenamento, Realtime.
- Janela do Start ao Stop, com margem. **Podem levar minutos para aparecer**: buscar em segunda fase, com novas tentativas.
- Ligar cada registro ao pedido gravado por horário + endereço + status (e identificador de requisição, se existir nos dois lados; verificar).
- Gravar o resultado como **`eventUpdates`** sobre o arquivo bruto, como o AppMap faz para enriquecer eventos.

---

## 8. O arquivo bruto (a base de tudo)

**Tudo nasce de um arquivo com todos os dados brutos**: execução do código + pedidos ao Supabase + (no site) estrutura e registros do Supabase. Diagramas, explicações e contexto são **sempre derivados** desse arquivo, nunca de outra fonte.

- **Formato:** o **formato AppMap**, o mais fiel possível à especificação (`referencias/appmap`): `version`, `metadata`, `classMap`, `events` (pares `call`/`return` com `id`, `parent_id`, `thread_id`, `timestamp`, `elapsed`), `http_server_request`/`http_server_response`, `http_client_request`/`http_client_response`, `message`, `labels`, `eventUpdates`.
- **Extensões** (documentar em `docs/format.md`, mantendo o arquivo válido no formato base sempre que possível):
  - **ações do usuário:** eventos sintéticos `call`/`return` (`defined_class: "Browser"`, `method_id`: `click`/`submit`/`navigate`, `labels: ["mapa.user-action"]`, descrição do elemento);
  - **camada** de cada evento: `browser`, `next-server`, `supabase`;
  - **Supabase:** tradução do pedido (seção 7.2), papel e id do usuário, ligação com a estrutura e os registros, grau de certeza;
  - **WebSocket** (Realtime).
- **Arquivos de uma gravação:**
  - `recording.appmap.json` → eventos e mapa de código (gerado no computador);
  - `supabase-schema.json` → retrato da estrutura do banco (gerado no site);
  - `eventUpdates` com os registros do Supabase (aplicados no site);
  - `interactions.json` → índice das ações do usuário, como as gravações por requisição do AppMap.
- **Validador** próprio pela especificação (ou o validador do AppMap, se a licença permitir).

---

## 9. Limites, refino, preparação e envio

### 9.1 Limites da gravação
Para sozinha no **primeiro** limite atingido:
- **Tempo:** padrão inicial de 2 minutos.
- **Tamanho:** número máximo de eventos e/ou megabytes.

Limitar só por tempo não garante tamanho previsível. Valores padrão saem da **Etapa 0**. Configurável (no futuro, por plano). Ao parar por limite: avisar com clareza e **salvar o que foi gravado**.

### 9.2 Preparação no computador (antes de enviar)
O arquivo bruto **completo** é enviado, mas antes:
- **Mascarar** senha, token, cookie, `authorization`, `apikey`, e-mail, CPF, cartão e campos configurados. Do token do Supabase, manter só papel e id do usuário. **Nunca desligado.**
- **Encurtar valores** (~100 caracteres, como recomenda a especificação do AppMap).
- **Excluir** `node_modules`, internos do Next e o que estiver em `exclude`.
- **Comprimir** (gzip).

### 9.3 Refino (como o AppMap)
- `npx mapa stats <gravação>`: funções mais chamadas, contagem e tamanho estimado, como o `appmap stats`.
- Sugerir exclusões para funções muito repetitivas (o AppMap usa como exemplo quem passa de 75 chamadas), que o usuário aceita para o `.mapa/config.json`.
- No site, corte automático de gravações grandes removendo as funções mais chamadas (o AppMap faz isso acima de ~10 MB), sempre avisando o que foi cortado.

### 9.4 Saída local
```
.mapa/recordings/<data-hora>-<nome>/
  recording.appmap.json.gz   → arquivo bruto, mascarado e válido
  interactions.json          → índice de ações do usuário
  upload.json                → status do envio e link no site
.mapa/CONTEXT.md             → contexto baixado com `npx mapa context`
```

---

## 10. Diagramas: método do AppMap, linguagem para leigos

**Regra:** a **estrutura** de cada diagrama (o que existe, o que cada um contém, como agrupar, filtrar e recolher) é **calculada por código, a partir do arquivo bruto, com o mesmo método do AppMap**. A **LLM só traduz a apresentação** para linguagem simples. Ela nunca inventa nem remove passos.

Estude, em `referencias/appmap-js` (modelos e diagramas) e na especificação de sequência (`referencias/appmap/sequence.json.md`), **como o AppMap constrói cada diagrama a partir dos eventos**, e reproduza o método com código nosso.

### 10.1 Os diagramas (um conjunto por ação gravada e um para a gravação inteira)

| Diagrama do AppMap | O que mostra no AppMap | Adaptação no Mapa |
|---|---|---|
| **Sequence Diagram** | Ordem cronológica; cada pacote é uma "raia" vertical; chamadas são setas; retornos na direção oposta; requisições recebidas à esquerda; banco e chamadas externas à direita; trechos podem ser recolhidos; raias podem ser ocultadas | Raias: **Usuário** → **Tela** (componentes agrupados por pasta) → **Servidor do Next** → **Supabase** (API, Login, Arquivos, Funções, Banco). Começa recolhido no nível mais simples; o usuário expande |
| **Dependency Map** | Todo o código envolvido numa funcionalidade e como se conecta: serviços web, código, bibliotecas, serviços externos e SQL; pacotes expansíveis; quem chama e quem é chamado | "Quais partes do app participaram": pastas e arquivos do usuário, rotas, tabelas, buckets e funções do Supabase, ligados pelas chamadas |
| **Trace View** | Árvore detalhada da execução, da requisição às funções e ao SQL; expandir/recolher; ver variáveis e valores; ir direto ao código | Árvore passo a passo do clique ao Supabase, com valores resumidos e link para arquivo:linha |
| **Flame Graph** | Tempo gasto em cada parte da pilha (largura proporcional à duração); cores por tipo (código, banco, serviço externo) | "Onde o app demorou", com as mesmas cores por tipo (navegador, servidor, Supabase) |
| **Stats** | Frequência das funções e tamanho na gravação | Estatísticas da gravação e sugestões de exclusão |

Comportamentos a reproduzir: filtros (ocultar código externo, código sem rótulo, pastas), recolher/expandir por profundidade, destacar rótulos (`security.*`), navegar entre diagramas pelo mesmo evento ("ver na sequência", "ver na árvore"), link para o código.

### 10.2 Pipeline
1. **Arquivo bruto** (seção 8).
2. **Modelos de diagrama** (código, pacote `diagrams`): JSON de sequência, dependências, árvore, tempos e estatísticas. Cada elemento guarda os ids dos eventos de origem.
3. **Camada de linguagem simples** (LLM, pacote `explain`), por modelo:
   - nomes amigáveis para raias, setas e caixas (sempre mostrando também o nome real no código e no banco);
   - uma explicação curta por passo e uma por ação;
   - o grau de certeza (seção 7.3) em linguagem simples;
   - o conceito técnico que aparece em cada passo, com o nome correto (ex.: "isto é uma **regra de acesso (RLS)**").
4. **Validação por código:** toda saída da LLM deve citar ids existentes nos modelos. Rejeitar e refazer se citar ids inexistentes, ou se adicionar/remover passos.
5. **Renderização no site:** diagramas interativos (recolher, expandir, clicar num passo para ver explicação e código). Exportação em Mermaid para o arquivo de contexto.

### 10.3 Arquivo de contexto
Gerado a partir do arquivo bruto + modelos: fluxos gravados, arquivos e funções envolvidos, rotas, tabelas, regras de acesso, gatilhos, Edge Functions, com diagramas em Mermaid. Baixado com `npx mapa context` para `.mapa/CONTEXT.md`, pensado para ser lido por IAs.

---

## 11. App de teste (`examples/next16-supabase-demo`)

App **Next.js 16** + **projeto Supabase hospedado de teste** (peça ao usuário para criar e fornecer as chaves como variáveis de ambiente; nunca commitar chaves).

**No Supabase de teste (via migrações):**
- `profiles` + gatilho **`handle_new_user`** em `auth.users`.
- `items` com **RLS** (`owner_id = auth.uid()`), com exclusão em cascata ligada ao usuário.
- Função `calcular_total` (RPC).
- Bucket `avatars` com política por usuário.
- Edge Function `send-welcome` com alguns `console.log`.
- Realtime em `items`.
- Atenção: em projetos novos, tabelas do `public` podem não ser expostas à API por padrão; conceder os acessos nas migrações.

**No app Next:** cadastro e login (`@supabase/ssr` + middleware/proxy de sessão); lista de itens no servidor e no navegador; botão "Adicionar item" (componente de cliente, função `formatarPreco`, inserção pelo `supabase-js`); server action que altera item; botões para `calcular_total` e para a Edge Function; envio de avatar; lista em tempo real; função `async` com `await` encadeado; erro proposital; botão com loop pesado; campo de senha.

**Cenários de referência:**
- **A — Cadastro:** formulário → função → `/auth/v1/signup` → gatilho cria o perfil (configurado no banco).
- **B — Adicionar item:** clique → handler (arquivo:linha) → `formatarPreco` → `POST /rest/v1/items` → resposta → tela; cita a regra RLS.
- **C — Lista deslogado:** resposta vazia explicada pela regra de acesso, não como "tabela vazia".
- **D — Edge Function:** chamada → resposta + `console.log` vindos dos registros.
- **E — Avatar:** envio → política do bucket.

---

## 12. Etapas

Uma etapa por vez. Só avance quando **todos** os critérios de "pronto" passarem, **rodando de verdade**. Ao fim de cada etapa: atualize `docs/decisions.md`, faça commit e mostre o que foi verificado e como.

### Etapa 0 — Estudo do AppMap e teste dos riscos
**Parte A — Estudo:** primeiro, explore a estrutura de cada repositório em `referencias/` e escreva o índice `docs/referencias.md` (seção 13.2). Depois, leia a documentação e o código do AppMap e escreva `docs/appmap-mapping.md`, aprofundando a tabela da seção 2.1. Para cada item: como o AppMap faz (com referência ao arquivo/trecho), como o Mapa vai fazer, e onde precisa ser diferente e por quê. Cobrir no mínimo: instrumentação e filtros do `appmap-node`, gravação remota, gravação por requisição, formato (inclusive `eventUpdates` e `labels`), estatísticas e refino, e **como cada diagrama é construído a partir dos eventos** (sequência, dependências, árvore, flame graph).

**Parte B — Riscos** (peça ao usuário o projeto Supabase de teste e um token pessoal da Management API, só para esta etapa):
1. Plugin via `turbopack.rules` aplicado separadamente ao navegador e ao servidor, não a `node_modules`; modo webpack; middleware/proxy.
2. Pilha assíncrona: `AsyncLocalStorage` (servidor) e marcação de `await` (navegador).
3. Captura dos pedidos do `supabase-js` no navegador e no servidor, com corpo e resposta.
4. Volume e desempenho: eventos e MB (antes/depois de comprimir) no cenário B, em 2 minutos de uso e no botão do loop; app usável; recarregamento automático funcionando.
5. Leitura da estrutura pelo endpoint só de leitura (políticas, gatilhos com código, chaves estrangeiras, buckets).
6. Registros: a chamada e os `console.log` da Edge Function do cenário D; tempo até aparecer; como ligar ao pedido gravado.

**Pronto quando:** `docs/referencias.md` lista os arquivos-chave de cada repositório; `docs/appmap-mapping.md` está completo, cita os arquivos de origem e foi revisado com o usuário; `docs/spike-report.md` responde às 6 perguntas com evidência e **propõe os limites padrão**. Se algo falhar, pare e reporte com alternativas.

### Etapa 1 — Estrutura, CLI e coletor
Monorepo; `mapa dev` (liga com `MAPA=1`, sobe o coletor, detecta bundler e versão do Node); coletor com Start/Stop.
**Pronto quando:** `npx mapa dev` liga o app de teste e `record start/stop` gera um arquivo válido no formato (ainda sem eventos).

### Etapa 2 — `withMapa`, plugin e `.mapa/config.json`
`withMapa` inerte sem `MAPA=1`; plugin completo para navegador e servidor (seção 6); `.mapa/config.json` com a semântica do `appmap.yml`.
**Pronto quando:** no cenário B aparecem as funções do navegador e da server action com arquivo:linha corretos, parâmetros e retornos no formato AppMap; nada de `node_modules`; pilha assíncrona correta; exclusões respeitadas; `next build` sem `MAPA=1` idêntico a um projeto sem o Mapa.

### Etapa 3 — Gravadores de navegador e servidor
Ações do usuário, `fetch`/XHR, WebSocket, erros, requisições recebidas no servidor, `traceparent` só na mesma origem, papel/id do usuário do Supabase, tradução dos pedidos (seção 7.2) e rótulos.
**Pronto quando:** os cenários A a E registram os pedidos ao Supabase traduzidos e rotulados, o papel/id de cada pedido, as mensagens do Realtime e o erro proposital; nenhum pedido ao Supabase recebe `traceparent`.

### Etapa 4 — Start/Stop, limites e arquivo bruto
Botão flutuante e comandos; limites com parada automática; junção navegador + servidor; `interactions.json`; mascaramento, encurtamento, exclusões, compressão; `npx mapa stats`; várias abas.
**Pronto quando:** Start → cenário B → Stop gera `recording.appmap.json.gz` válido, com a cadeia completa; o botão do loop para a gravação pelo limite e salva o que foi gravado; senha, token completo e `apikey` não aparecem no arquivo; `mapa stats` lista as funções mais chamadas.

### Etapa 5 — Plataforma: contas, login e envio
Site com contas; tabelas com **RLS em todas** e bucket **privado**; `mapa login`/`logout`; envio com URL assinada, confirmação na primeira vez, reenvio com `mapa upload`.
**Pronto quando:** do zero, conta → login → gravação → aparece no site como "recebida"; um segundo usuário não acessa a gravação do primeiro (testado).

### Etapa 6 — "Conectar Supabase" e estrutura
**Pare e peça ao usuário** para criar o OAuth App. Fluxo OAuth com PKCE, escolha do projeto, tokens criptografados, renovação, "Desconectar"; leitura da estrutura e retrato por gravação.
**Pronto quando:** conectar o projeto de teste mostra tabelas, políticas, gatilhos (com código), buckets e Edge Functions; só o endpoint de leitura é usado; desconectar apaga os tokens.

### Etapa 7 — Processamento: refino, Supabase e registros
Fila de processamento; validação; refino e corte (seção 9.3); cruzamento com a estrutura (grau "configurado no banco"); registros em segunda fase como `eventUpdates` (grau "confirmado pelos registros"); status recebida → processando → pronta (app) → pronta (com registros) / erro.
**Pronto quando:** cenário A mostra o perfil criado pelo gatilho ("configurado no banco"); cenário C atribui a resposta vazia à regra de acesso, citando a política; cenário D mostra os `console.log` ("confirmado pelos registros").

### Etapa 8 — Modelos de diagrama (método do AppMap)
Pacote `diagrams`: sequência, dependências, árvore, tempos e estatísticas, por ação e para a gravação inteira, seguindo `docs/appmap-mapping.md`.
**Pronto quando:** para os cenários A a E, os modelos reproduzem as convenções do AppMap (raias, ordem, posições, recolher/ocultar, filtros) adaptadas às raias do Mapa; cada elemento aponta para eventos existentes; testes automatizados comparam os modelos com saídas esperadas.

### Etapa 9 — Camada LLM e contexto
Pacote `explain`: nomes amigáveis, explicações por passo e por ação, grau de certeza, conceitos técnicos com o nome correto; validação de ids; arquivo de contexto; provedor configurável (começar com Gemini); chave só no servidor; custo registrado por gravação.
**Pronto quando:** os cenários A a E geram diagramas e explicações compreensíveis para quem não programa, sem passos inventados ou removidos (validado), e `npx mapa context` baixa o contexto.

### Etapa 10 — Site: visualização
Lista de projetos e gravações; página da gravação com as ações; para cada ação, os diagramas da seção 10.1 interativos, explicações, grau de certeza, navegação entre diagramas e link para o código; aviso quando o Supabase não está conectado; download do arquivo bruto; português simples; funciona no celular.
**Pronto quando:** os cenários A a E podem ser navegados inteiros no site, do clique ao Supabase, em todos os diagramas.

### Etapa 11 — `mapa init` e testes ponta a ponta
`mapa init` completo e `mapa uninstall`; teste Playwright nos modos Turbopack e webpack (gravação → envio → diagramas prontos); README.
**Pronto quando:** num clone limpo do app de teste, o fluxo completo funciona do zero e o teste passa nos dois modos.

### Etapa 12 — Cobrança (pode ser adiada)
Assinatura mensal (Stripe ou equivalente no Brasil); plano gratuito com limites e plano pago; CLI respeita os limites; bloqueio com mensagem clara.
**Pronto quando:** usuário gratuito é bloqueado no limite; ao assinar (modo de teste), os limites aumentam sozinhos; cancelar volta ao gratuito.

---

## 13. Referências (`referencias/`)

### 13.1 Onde estão
Os repositórios **já estão clonados** na pasta `referencias/`, na raiz deste projeto:

```
referencias/
  appmap/                 → especificação do formato AppMap
  appmap-node/            → agente do AppMap para Node.js (o "gravador" de backend)
  appmap-js/              → bibliotecas do AppMap: modelos, diagramas, validador, CLI
  locatorjs/              → exemplo de encaixe de plugin no Next.js (Turbopack e webpack)
  babel-plugin-istanbul/  → exemplo de plugin Babel que instrumenta todo o código
```

### 13.2 Regras
- **Somente leitura.** Não editar, não atualizar (`git pull`), não instalar dependências nem rodar build dentro de `referencias/`. Se precisar ver algo funcionando, use a documentação ou pergunte.
- **Fora do nosso código.** Confirme que `referencias/` está no `.gitignore` deste projeto. Nunca importe nada de `referencias/` no código do Mapa.
- **Não copiar código** de nenhum repositório do AppMap (seção 2.2). Ler para entender **como** fazem e reescrever com código nosso. Dos outros (LocatorJS, Istanbul), também escreva código próprio; se reaproveitar algo, leia o `LICENSE` e avise.
- **Ler só o necessário.** Os repositórios são grandes. Use busca por nome de arquivo e por texto para ir direto ao trecho relevante; não leia repositórios inteiros.
- **Sempre citar a fonte** nas decisões: ao registrar em `docs/appmap-mapping.md` ou `docs/decisions.md` algo inspirado numa referência, indique o repositório e o arquivo.
- **Índice:** na Etapa 0, explore a estrutura de cada repositório e escreva `docs/referencias.md` com os arquivos e pastas mais importantes de cada um e para que servem. Nas etapas seguintes, consulte esse índice antes de buscar nos repositórios.

### 13.3 Cada repositório: para que serve e quando usar

**`referencias/appmap/` — especificação do formato**
- **O que tem:** a especificação do formato AppMap (`README.md`: `metadata`, `classMap`, `events`, requisições, SQL, `labels`, `eventUpdates`, histórico de versões) e a especificação do modelo de diagrama de sequência (`sequence.json.md`).
- **Para quê:** definir o **arquivo bruto** (seção 8) o mais fiel possível ao formato AppMap e documentar nossas extensões em `docs/format.md`; entender como o AppMap representa um diagrama de sequência.
- **Quando:** Etapa 0 (estudo), Etapas 1 a 4 (formato do arquivo bruto), Etapa 7 (`eventUpdates`), Etapa 8 (modelo de sequência).

**`referencias/appmap-node/` — o gravador de backend do AppMap**
- **O que tem:** o código-fonte do agente Node (pasta `src/`), testes (`test/`) e notas de manutenção (`docs/`).
- **Para quê:** é a **referência principal para os nossos sensores**. Entender como ele:
  - altera o código ao carregar, sem mexer nos arquivos;
  - decide quais funções envolver e aplica `packages`/`exclude` do `appmap.yml`;
  - registra cada chamada e retorno (parâmetros, valores, exceções, tempo);
  - mantém a pilha de chamadas com código `async`;
  - grava requisições HTTP recebidas e feitas, e consultas a banco;
  - implementa a gravação remota (Start/Stop) e a gravação por requisição;
  - resume e encurta valores.
- **Quando:** Etapa 0 (estudo), Etapa 2 (plugin e `.mapa/config.json`), Etapa 3 (gravadores), Etapa 4 (Start/Stop e limites).
- **Atenção:** é aqui que a regra de **não copiar código** mais importa (licença com Commons Clause).

**`referencias/appmap-js/` — modelos, diagramas e ferramentas do AppMap**
- **O que tem:** vários pacotes em `packages/`, entre eles `models` (como os eventos são lidos e organizados), `diagrams` e `components` (como os diagramas são montados e exibidos), `validate` (validador do formato) e `cli` (comandos como estatísticas e refino).
- **Para quê:** é a **referência principal para os diagramas e o refino**. Entender como o AppMap:
  - transforma eventos em sequência, mapa de dependências, árvore de execução e flame graph;
  - agrupa código em "raias" e caixas, ordena, recolhe, oculta e filtra;
  - calcula estatísticas (funções mais chamadas, tamanho) e corta gravações grandes;
  - valida um arquivo no formato.
- **Quando:** Etapa 0 (estudo), Etapa 4 (`mapa stats`), Etapa 7 (refino e corte), Etapa 8 (modelos de diagrama), Etapa 10 (comportamento interativo dos diagramas no site).
- **Atenção:** a licença deste repositório ainda não foi verificada. Leia o `LICENSE` de cada pacote antes de usar qualquer um como dependência (ex.: o validador) e pergunte.

**`referencias/locatorjs/` — encaixe no Next.js**
- **O que tem:** o LocatorJS, incluindo o pacote `@locator/webpack-loader`, que aplica uma transformação Babel aos arquivos de um app Next 15/16 tanto com Turbopack quanto com webpack, e testes com Next 16.
- **Para quê:** é a **referência para o `withMapa`**: como registrar um loader em `turbopack.rules` e na configuração do webpack, com quais condições, como lidar com componentes de cliente e de servidor, e quais limitações apareceram (ex.: middleware).
- **Quando:** Etapa 0 (teste de risco 1) e Etapa 2 (`withMapa`).

**`referencias/babel-plugin-istanbul/` — plugin Babel que instrumenta código**
- **O que tem:** um plugin Babel mantido (licença BSD-3-Clause) que insere código de medição em todo o código de um projeto, usado por ferramentas de cobertura de testes.
- **Para quê:** é a **referência para o nosso plugin Babel**: estrutura de um plugin, como percorrer e alterar funções sem mudar o comportamento, como incluir/excluir arquivos e como preservar source maps.
- **Quando:** Etapa 0 (teste de risco 1) e Etapa 2 (plugin).

### 13.4 Guia rápido: "tenho uma dúvida, onde olho?"

| Dúvida | Onde olhar primeiro |
|---|---|
| Que campo usar no arquivo bruto? Como representar um evento? | `appmap/README.md` |
| Como ligar eventos que chegam depois (registros do Supabase)? | `appmap/README.md` (`eventUpdates`) |
| Quais funções anotar e como aplicar inclusões/exclusões? | `appmap-node/src` |
| O que registrar em cada chamada e retorno? Como resumir valores? | `appmap-node/src` + `appmap/README.md` |
| Como manter a pilha com `async`? | `appmap-node/src` (servidor); no navegador, seção 6 deste arquivo |
| Como funciona Start/Stop e gravação por requisição? | `appmap-node/src` + documentação de gravação remota do AppMap |
| Como encaixar o plugin no Next com Turbopack/webpack? | `locatorjs` (`@locator/webpack-loader`) |
| Como escrever o plugin Babel em si? | `babel-plugin-istanbul` |
| Como montar o diagrama de sequência? | `appmap/sequence.json.md` + `appmap-js/packages` (modelos e diagramas) |
| Como montar o mapa de dependências, a árvore e o flame graph? | `appmap-js/packages` (modelos, diagramas, componentes) |
| Como calcular estatísticas e cortar gravações grandes? | `appmap-js/packages` (CLI e modelos) + documentação de refino do AppMap |
| Como validar o arquivo? | `appmap-js/packages/validate` (verificar licença antes de usar) |

Se a resposta não estiver nas referências, consultar a documentação oficial: AppMap (diagramas, refino, diagramas grandes, rótulos, gravação remota), Next.js (`turbopack`, OpenTelemetry, middleware/proxy), Supabase (Management API, "Build a Supabase Integration", logs, PostgREST) e Babel.

---

## 14. Regras de trabalho

- **Retomar de onde parou:** ao iniciar uma sessão, leia `docs/status.md` para saber onde o trabalho parou (seção "Como retomar"). Mantenha esse arquivo atualizado a cada avanço e sempre que parar, inclusive no meio de uma etapa.
- **AppMap primeiro:** diante de qualquer dúvida de desenho, consulte `docs/appmap-mapping.md` e as referências antes de inventar.
- **Verifique rodando.** Nunca declare uma etapa pronta sem executar os critérios e mostrar a evidência.
- **Pare e pergunte** quando uma decisão mudar o escopo, quando um risco se confirmar, quando precisar de contas/credenciais (Supabase de teste, OAuth App, LLM, pagamento) ou quando algo exigir alterar arquivos do usuário além do `mapa init`.
- **Não altere os arquivos do usuário** fora do `mapa init` confirmado.
- **Acesso ao Supabase do usuário é sempre só de leitura.**
- **Nada é enviado** sem login e sem a confirmação da primeira vez. O mascaramento roda sempre.
- **Segredos** (chave da LLM, tokens OAuth dos usuários, chaves do Supabase do Mapa, chaves de pagamento) só no servidor, em variáveis de ambiente ou criptografados. Nunca no CLI, no navegador, em gravações ou no repositório.
- **Fixe versões** das dependências.
- Commits pequenos. Decisões registradas em `docs/decisions.md`.
- Mensagens ao usuário final em **português simples**. Código, nomes e comentários em inglês.

---

## 15. Riscos conhecidos

| Risco | Situação | Plano |
|---|---|---|
| Licença do AppMap | `appmap-node`: MIT + Commons Clause (proíbe vender produto baseado nele) | Usar o AppMap como desenho; implementar com código nosso; formato a confirmar com advogado |
| Plugin via `turbopack.rules` no servidor e no middleware | LocatorJS usa o mesmo encaixe; há relato de limitação no middleware com Turbopack | Testar na Etapa 0 |
| Pilha assíncrona no navegador | Sem solução nativa | Marcar `await` no plugin |
| Tamanho das gravações | Só tempo não controla o volume | Limites de tempo e tamanho + refino como o AppMap |
| `traceparent` para outras origens | Preflight pode quebrar requisições | Só mesma origem |
| Babel no Next com webpack | `babel.config.js` desliga o SWC | Loader via regras do bundler |
| React 19 sem `_debugSource` | Removido | Arquivo/linha do plugin e dos source maps |
| O que roda dentro do Supabase | Não aparece na execução | Estrutura + registros, com grau de certeza |
| Atraso dos registros | Minutos | Segunda fase com `eventUpdates` |
| APIs do Supabase em beta | Consulta só leitura em beta; endpoint antigo de logs removido | Isolar no pacote `supabase`; testar; acompanhar changelog |
| LLM inventar passos | Diagramas para leigos dependem da LLM | Estrutura calculada por código; LLM só traduz; validação de ids |
| Confiança do usuário | Gravação completa e acesso ao Supabase | Mascaramento, só leitura, permissões mínimas, "Desconectar", RLS, bucket privado |
| Custo da LLM | Pago por nós | Registrar tokens; limites por plano |
