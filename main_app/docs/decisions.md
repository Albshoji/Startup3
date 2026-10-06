# Decisões e motivos

Formato: data · decisão · motivo · fonte (quando inspirada numa referência).

## Pendências (aguardando o dono do projeto)

- **[JURÍDICO] Formato AppMap em produto pago.** Antes do lançamento comercial, confirmar com advogado se seguir o formato AppMap (especificação em `referencias/appmap/README.md`) é compatível com a licença. O código do AppMap **não** é usado (CLAUDE.md §2.2).

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

## Etapa 0, Parte B (riscos 1, 2 e 4)

- **2026-10-05 · Protótipo descartável em `spikes/etapa0/`.** Serve só de evidência; o código do produto será escrito do zero nas Etapas 1–4. Gravações grandes (`*.appmap.json*`) ficam fora do Git.
- **2026-10-05 · Turbopack: duas regras** (`browser` / `not browser`, ambas `not foreign`) em `*.{js,jsx,ts,tsx,mjs,cjs}`; **webpack: `enforce: "pre"`** para receber o código original. Evidência: `docs/spike-report.md`, risco 1.
- **2026-10-05 · Server actions sem `this`/`arguments`:** envoltório com `...args` em código `"use server"` (o Next recusa compilar de outro jeito).
- **2026-10-05 · Marcação de `await` também em `node_modules/@supabase/`** (só marcação, sem gravar funções), via condição `path` do Turbopack; inferência pela "função suspensa mais recente da mesma ação" como reserva. Motivo: `fetchWithAuth` do `supabase-js` faz `await` antes do `fetch`.
- **2026-10-05 · Callbacks de hooks do React (`useEffect`, `useCallback`, `useMemo`…) são instrumentados**, com nome `Componente.hook@linha`. Motivo: sem isso o padrão `useEffect + supabase.then` fica órfão.
- **2026-10-05 · Ações do usuário:** `click`, `submit`, `type` (agrupado por campo, intervalo < 1 s), `navigate` (carga, `pushState`, `popstate`). Re-renderizações sem pai vão para a ação aberta mais recente, como "inferidas".
- **2026-10-05 · Um identificador por carga de página/aba**, usado como trace-id do `traceparent` e para não misturar ids entre recargas.
- **2026-10-05 · Resumo de valores sem efeitos colaterais:** nunca acessar thenables nem getters (o Next 16 acusa erro ao ler `params` de forma síncrona).
- **2026-10-05 · Limites propostos (aguardando aprovação):** 2 min; teto de 50 chamadas por função dentro de cada ação (o resto só é contado); 50 000 eventos; 12 MB de JSON. Ver `docs/spike-report.md`, risco 4.

### Pendências novas
- **Babel 8 (Node ≥ 22.18) ou Babel 7 (Node 22 mais antigo):** decidir na Etapa 2.
- **[JURÍDICO]** continua pendente (ver topo).

## Etapa 0, Parte B (riscos 3, 5 e 6)

- **2026-10-05 · Projeto de teste montado com autorização do dono** ("autorizo escrever no projeto de teste Startup3 nesta sessão"): migração `examples/next16-supabase-demo/supabase/migrations/20261005000001_schema_inicial.sql` aplicada pelo endpoint de migrações da Management API; Edge Function `send-welcome` publicada pelo endpoint de deploy. A mudança da configuração de autenticação (desligar confirmação de e-mail) foi **barrada** pelo controle de permissões e ficou com o dono.
- **2026-10-05 · Registros: coluna `source`, não `source_name`.** O changelog do Supabase cita `source_name`, mas a API real recusa esse campo. CLAUDE.md §7.6 corrigido com aprovação do dono.
- **2026-10-05 · Ligação com os registros:** no servidor, exata por `sb-request-id`; no navegador, por horário + método + caminho + status (o CORS não expõe `sb-request-id`). `console.log` de Edge Functions por `execution_id`.
- **2026-10-05 · Busca dos registros com fila e espera** (a API devolve `Too Many Requests` com consultas seguidas; a cada 15 s não recusou).
- **2026-10-05 · Permissões da API lidas por `pg_class.relacl`** (o `information_schema` volta vazio no endpoint só de leitura).
- **2026-10-05 · Papel e id do usuário só de `role`/`sub` do JWT**; chaves novas `sb_publishable_` não são JWT (papel "opaque-key").
- **2026-10-05 · Máscara de corpos, parâmetros e query string** (senha, token, segredo, cartão, CPF, e-mail, JWT), aplicada antes de resumir. Testada no cadastro real: nenhuma senha, e-mail, token ou chave nas gravações.
- **2026-10-05 · Projeto de teste com "Confirm email" desligado** (feito pelo dono no painel), para os cenários com login. O cenário "e-mail de confirmação enviado" fica para quando a confirmação for religada.

## Decisões do dono (2026-10-05)

- **Tempo máximo de gravação: 1 minuto** (o CLAUDE.md §9.1 falava em 2 minutos como "padrão inicial"; a sessão realista medida coube com folga em 2 min, então 1 min dá ainda mais margem). Demais limites seguem a proposta: 50 chamadas por função por ação, 50 000 eventos, 12 MB.
- **`@appland/appmap-validate` autorizado como dependência de desenvolvimento, só nos testes** (licença MIT, `referencias/appmap-js/packages/validate/LICENSE`). O produto continua com validador próprio.
- **CLAUDE.md §7.6 corrigido** (`source_name` → `source`, mais o aviso de limite de requisições da API de registros).
- **Teto de 50 chamadas por função dentro de cada ação: mantido, ligado por padrão**, com a contagem do que foi agrupado visível nos diagramas ("+150 chamadas iguais") e configurável no `.mapa/config.json`. Nada além das repetições deixa de ser gravado; a divisão por ação do usuário só organiza a gravação (índice `interactions.json`), não descarta passos.
- **Critério da Etapa 4 adaptado:** com o teto, o botão do loop não estoura o limite de tamanho. O teste da Etapa 4 passa a verificar (a) o teto agrupando as chamadas repetidas do loop, com a contagem, e (b) a parada automática pelo limite (1 minuto, ou eventos/MB com o teto desligado), salvando o que foi gravado.

## Etapa 0: concluída (2026-10-05)

| Critério | Situação |
|---|---|
| `docs/referencias.md` lista os arquivos-chave de cada repositório | ✅ |
| `docs/appmap-mapping.md` completo, cita as fontes, revisado com o dono | ✅ (revisado pelo resumo em linguagem simples; dúvida sobre a divisão por ação esclarecida) |
| `docs/spike-report.md` responde às 6 perguntas com evidência e propõe limites | ✅ (limites decididos: 1 min, 50 por função por ação, 50 000 eventos, 12 MB) |

## Etapa 1

- **2026-10-06 · Nome provisório do pacote: `@mapa/cli`**, com o comando `mapa`. O nome `mapa` no npm já pertence a outra biblioteca; o nome definitivo será escolhido antes de publicar.
- **2026-10-06 · pnpm 12.9.1 via corepack** (`packageManager` no `package.json` da raiz), sem instalação global; os scripts da raiz não chamam `pnpm` de dentro de si mesmos.
- **2026-10-06 · TypeScript 5.9.3** (e não o 7.0, que é a reescrita nativa, ainda nova); módulos ESM, `tsc -b` com referências entre pacotes. Testes com `node --test`, sem dependências.
- **2026-10-06 · Pacotes criados só quando a etapa precisa deles** (`format`, `collector`, `cli` agora); os demais da seção 5 do CLAUDE.md entram nas suas etapas.
- **2026-10-06 · Arquivo declara `version: "1.14"`; testes validam uma cópia com `"1.13.1"`.** O `@appland/appmap-validate` 2.5.1 só conhece o esquema até 1.13.1 e confere o valor de `version`. Ele também devolve a versão (e não `undefined`, como diz o README) quando o arquivo é válido; o sinal de erro é a exceção. Ver `docs/format.md`.
- **2026-10-06 · Coletor:** só em `127.0.0.1`, porta 47100 (ou a próxima livre), recusa `Host` que não seja local (proteção contra páginas que tentem falar com ele), mesma API da gravação remota do AppMap (`GET/POST/DELETE /record`, 409 e 404). Onde está rodando fica em `.mapa/collector.json`, que `mapa record` lê. Fechar o `mapa dev` no meio de uma gravação salva o que foi gravado (`stopped_by: "shutdown"`).
- **2026-10-06 · `mapa dev`** encontra o projeto Next mais próximo, roda o `next` instalado no app com o Node atual, passa `MAPA=1`, `MAPA_COLLECTOR_URL` e `MAPA_BUNDLER`, e repassa sinais. Detecção: Next 16 usa Turbopack salvo `--webpack`; Next 15 usa webpack salvo `--turbopack`. Avisa (sem bloquear) fora do Node 22/24 e do Next 15/16.
- **2026-10-06 · URL do repositório no metadata sem credenciais** (remove `usuário:senha@` de URLs https).

### Etapa 1: concluída (2026-10-06)

| Critério | Evidência |
|---|---|
| `npx mapa dev` liga o app de teste | Em `examples/next16-supabase-demo`: `[mapa] Next 16.3.8 · Turbopack · Node v24.19.0`, coletor em `127.0.0.1:47100`, página 200; o processo do Next recebeu `MAPA=1` |
| `record start/stop` gera arquivo válido (sem eventos) | `.mapa/recordings/<data>-teste-etapa-1/recording.appmap.json.gz` + `interactions.json`; `validate-recording.mjs`: "válido · version 1.14 · 0 eventos · parado por: user" |
| Extras verificados | 2º `start` recusado; `stop` sem gravação avisa; fechar o `mapa dev` gravando salva (`shutdown`) e libera as portas; 9 testes automáticos passando (`corepack pnpm test`) |

## Etapa 2

- **2026-10-06 · Projeto movido para `main_app/` pelo dono** (com uma pasta `landing_page/` ao lado). O repositório Git continua na pasta de cima; os caminhos dos documentos são relativos a `main_app/`.
- **2026-10-06 · Babel 8.0.6** (a versão atual). Exige Node `^22.18` ou `>=24.11`; o `mapa dev` recusa versões mais antigas com uma mensagem clara (`packages/cli/src/project.ts: missingNodeRequirement`). Motivo: o Babel 7 só recebe correções de manutenção e o protótipo da Etapa 0 já foi validado com o 8.
- **2026-10-06 · Novos pacotes:** `@mapa/babel-plugin` (ESM), `@mapa/browser-runtime`, `@mapa/server-runtime` (ESM, empacotados pelo Next junto com o app) e `@mapa/next-plugin` (**CommonJS**, porque o Next carrega o `next.config` com `require`; o loader importa os pacotes ESM com `import()`). Peças comuns (resumo de valores, máscara, regras do `config.json`, montagem do arquivo, contrato com os gravadores) ficam em `@mapa/format`.
- **2026-10-06 · `parent_id` no `call` só no transporte.** Revisa a decisão da Etapa 0: o esquema do AppMap proíbe `parent_id` em `call` (achado ao validar). O coletor reconstrói a ordem pela árvore de pais, renumera os ids e remove o campo (`packages/format/src/linearize.ts`). Equivale ao "achatamento" dos buffers do `appmap-node` (`src/Recording.ts`), feito no coletor em vez de no gravador.
- **2026-10-06 · `return` sintético** (`incomplete: true`) para chamadas sem retorno no Stop, e `metadata.mapa.incomplete_calls`. Motivo: sem isso, a ordem por thread fica inválida para quem lê o arquivo.
- **2026-10-06 · Retorno de função `async` gravado quando a Promise termina** (o `appmap-node` grava na hora e corrige depois). Possível porque a ordem é reconstruída pelo coletor; o `elapsed` fica correto sem `eventUpdates`.
- **2026-10-06 · Regra do servidor no Turbopack com a condição `node`** (`{all: [{not: "browser"}, "node", {not: "foreign"}]}`), e no webpack sem o runtime `edge`. Motivo: o gravador do servidor usa `node:http` e `AsyncLocalStorage`; o `appmap-node` também ignora o edge (`src/hooks/next.ts`). No Next 16 o `proxy.ts` roda em Node e é gravado (verificado).
- **2026-10-06 · Gravador do servidor fala com o coletor por `node:http`**, não por `fetch` (o Next altera o `fetch` do servidor para cache; nossos envios não devem passar por ele).
- **2026-10-06 · Gravadores consultam o coletor a cada 1 s** (`GET /record`) e só registram durante a gravação; lotes a cada 0,5 s (navegador) e 0,3 s (servidor); o coletor espera 1 s no Stop pelos últimos lotes. CORS só para origens locais; `text/plain` evita *preflight*. O botão flutuante da Etapa 4 vai tornar o início imediato.
- **2026-10-06 · Marcação de `await` só no código do navegador** (no servidor o `AsyncLocalStorage` resolve). Cada função `async` com `await` ganha `const __mf = cur(); let __mw = 0; try { … } finally { rs(__mw ? null : __mf) }`. Motivo (achado rodando o cenário B): sem limpar a pilha no fim de uma continuação, as re-renderizações do React e até o clique seguinte apareciam como filhos do handler anterior. Se a função termina sem ter esperado, a pilha de quem a chamou é mantida.
- **2026-10-06 · Impressão digital nas opções do loader** (hash do `.mapa/config.json` e do código do plugin). Motivo (achado rodando): o Turbopack guarda os arquivos transformados entre execuções; sem isso, mudar o `config.json` ou atualizar o Mapa não teria efeito até apagar `.next`. Mudanças no `config.json` valem ao reiniciar o `mapa dev`, que avisa quando o arquivo muda (o `appmap-node` também só lê o `appmap.yml` ao iniciar).
- **2026-10-06 · `exclude` por trecho do caminho *relativo ao projeto*** (o `appmap-node` compara com o caminho absoluto, `src/PackageMatcher.ts`). Motivo: evita excluir tudo por acaso quando uma pasta acima do projeto tem um nome como `public`. `node_modules/`, `.next/` e `.mapa/` ficam sempre de fora. `functions` (rótulos por nome) também aceito no nível de cima do arquivo, além de por pacote como no AppMap.
- **2026-10-06 · Mais formas de função recebem nome** do que no `appmap-node` (`src/hooks/instrument.ts`): `let`/`var`, atribuições (`exports.x =`), propriedades de classe com arrow, métodos privados, function expressions com nome, callbacks de hooks (`const salvar = useCallback(...)` → `salvar`; `useEffect(...)` → `Componente.useEffect@linha`). Construtores, getters, setters e generators não são envolvidos (como no AppMap).
- **2026-10-06 · Componentes React:** o primeiro parâmetro se chama `props` quando não declarado, e só os argumentos declarados são gravados (o React passa um segundo argumento que ninguém usa).
- **2026-10-06 · `receiver` (o `this`) não é gravado** (o AppMap grava). Motivo: volume e risco de ler objetos grandes ou com efeitos colaterais. Rever na Etapa 8 se algum diagrama precisar.
- **2026-10-06 · Tabela `__mapaFns` com `var`** (não `const`): uma função chamada durante uma importação circular não pode cair na "zona morta" do `const`. Arquivos CommonJS recebem `require()` do gravador em vez de `import`.
- **2026-10-06 · App de teste:** `tsconfig.json` passa a excluir `supabase/functions` (código Deno quebrava a checagem de tipos do `next build`); novos `components/AddItem.tsx` (cenário B), `components/AsyncChain.tsx` (await encadeado), `app/actions.ts` (server action), `lib/precos.ts`, `lib/supabase-browser.ts` e `proxy.ts` (sessão do Supabase).

### Pendências novas
- **Next 15 não foi testado** (não temos app Next 15). Em especial, as condições em `turbopack.rules` com `next dev --turbopack` no Next 15. Verificar na Etapa 11.

### Etapa 2: concluída (2026-10-06)

| Critério | Evidência |
|---|---|
| Cenário B: funções do navegador e da server action com arquivo:linha, parâmetros e retornos no formato AppMap | Gravação real (Turbopack e webpack): `AddItem.onClick@32` (components/AddItem.tsx:32) → `adicionarItem` (:14) → `formatarPreco` (lib/precos.ts:6, `valor=9.9` → `"R$ 9,90"`) → `criarClienteNavegador`; no servidor `actions.alterarItem` (app/actions.ts:5, `id=1, nome="Pão"` → `{ok: true}`, rótulo `mapa.server-action`) → `criarClienteServidor` → `getAll`; `proxy.proxy` (proxy.ts:5). Validador do AppMap: "válido · 66 eventos" |
| Nada de `node_modules` | Registro do loader: só arquivos do projeto (`proxy.ts`, `app/`, `components/`, `lib/`); nenhuma ocorrência de `node_modules` nas gravações |
| Pilha assíncrona correta | Navegador: dois `processarPedido` simultâneos, cada `somarItens`/`calcularFrete` (chamados depois de `await`) dentro do seu próprio pedido; re-renderizações não ficam presas ao handler. Servidor: filhos da server action depois de `await` ligados a ela |
| Exclusões respeitadas | Com `exclude: ["lib/supabase-browser", "formatarPreco", "esperar"]` e um rótulo por nome: 0 ocorrências das excluídas, rótulo aplicado; valeu após reiniciar mantendo o cache do Next; aviso ao mudar o arquivo |
| `next build` sem `MAPA=1` idêntico | 3 builds (sem `withMapa`, com `withMapa`, sem de novo): os arquivos que diferem entre "sem" e "com" são exatamente os mesmos que diferem entre dois builds iguais sem o Mapa (identificador do build e chaves das server actions, sorteados pelo Next); nenhuma ocorrência de `__mapa`/`@mapa` no build |
| Testes automáticos | 45 passando (`corepack pnpm test`): plugin (transformação e comportamento preservado: `this`, `arguments`, `super`, valores padrão, exceções, server actions, TypeScript), gravação da pilha, linearização validada pelo validador do AppMap, coletor, `withMapa` e loader |
