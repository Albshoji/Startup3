# Etapa 0, Parte B: relatório dos testes de risco

> Situação: **riscos 1, 2 e 4 testados** (sem credenciais). **Riscos 3, 5 e 6 pendentes**
> (precisam do projeto Supabase de teste e do token da Management API).
>
> Data: 2026-10-05. Máquina: Linux x86_64, 8 núcleos, 18 GB, Node 24.19.0.
> Versões fixadas: `next` 16.3.8, `react` 19.3.0, `@babel/core` 8.0.6, `@supabase/supabase-js` 2.117.2,
> `@supabase/ssr` 0.12.7, `typescript` 5.9.3, `playwright` 1.63.0 (Chromium headless).

## Como foi testado

Protótipo **descartável** em `spikes/etapa0/` (não é o código do produto):

| Arquivo | Papel |
|---|---|
| `app/` | App Next 16 de teste: cenário B (clique → handler → `supabase-js` insert → `formatarPreco` → tela), server action, rota `/api/hello`, `proxy.ts`, `enum` TypeScript, `await` encadeado, loop de 10 mil chamadas, erro proposital, lista de 200 itens com busca, `useEffect` + `.then()` |
| `app/mapa-proto/with-mapa.cjs` | `withMapa`: inerte sem `MAPA=1`; registra o loader em `turbopack.rules` (2 regras: navegador / não-navegador, ambas sem `foreign`) e em `webpack()` (`enforce: "pre"`) |
| `app/mapa-proto/loader.cjs` + `babel-plugin.cjs` | Loader e plugin Babel: envolve funções, marca `await`, mantém TypeScript, gera source map |
| `app/mapa-proto/runtime-browser.js` | Gravador do navegador: pilha lógica, ações do usuário, `fetch`, envio ao coletor |
| `app/mapa-proto/runtime-server.js` | Gravador do servidor: `AsyncLocalStorage`, requisições recebidas, `fetch` de saída |
| `collector.mjs` | Coletor mínimo: junta navegador + servidor, monta o arquivo, mede tamanho (JSON e gzip) |
| `mock-supabase.mjs` | **Supabase falso** local (PostgREST/Auth mínimos), para exercitar o `supabase-js` sem credenciais |
| `app/run-scenarios.mjs`, `run-perf.mjs`, `check-*.mjs` | Automação com Playwright |
| `out/*.json` | Resultados (análises e medições). As gravações grandes ficam fora do Git |

---

## Risco 1: plugin via `turbopack.rules` no navegador e no servidor, sem `node_modules`; webpack; middleware/proxy

**Resposta: funciona.** Evidências:

| Pergunta | Resultado | Evidência |
|---|---|---|
| Regras separadas para navegador e servidor no Turbopack | ✅ condições `{all: ["browser", {not: "foreign"}]}` e `{all: [{not: "browser"}, {not: "foreign"}]}` aplicam o loader com a camada certa | `loader.log`: cada arquivo aparece como `browser` e/ou `server` (ex.: `components/AddItem.tsx` nos dois, `app/actions.ts` nos dois, `proxy.ts` só `server`) |
| `node_modules` fica de fora | ✅ nenhum arquivo de `node_modules` passou pelo loader nas regras normais (84 arquivos, todos do projeto) | `loader.log` |
| Regra extra só para `node_modules/@supabase/` | ✅ condição `{path: RegExp}` funciona no Turbopack (54 arquivos marcados) | `loader.log` (`browser+awaits`) |
| Modo webpack (`next dev --webpack`) | ✅ mesmas cadeias e mesmas linhas de origem; `enforce: "pre"` faz o loader receber o código original | `out/webpack-*.analysis.json` |
| `proxy.ts` (antigo middleware) | ✅ no Next 16.3 o proxy roda em Node, recebe o loader e fica ligado à requisição: `REQ POST / → proxy.proxy (proxy.ts:7) → proxy.marcarVisita (proxy.ts:3)` | `out/turbopack-v2-server-action.appmap.json` (gerado localmente, fora do Git; regenerar com `run-scenarios.mjs`) |
| TypeScript-only (`enum`) | ✅ Babel mantém o TS; nenhum erro de parse (o `appmap-node` perde esses arquivos) | `lib/precos.ts` instrumentado |
| Source maps | ✅ o erro proposital aponta para `components/ErrorButton.tsx:4` (linha exata do `throw`) na API de erros do Next | `check-sourcemap.mjs` |
| Recarregamento automático (HMR) | ✅ Turbopack 61 ms, webpack 207 ms, **sem recarregar a página** (estado mantido) | `out/*-scenarios.json` (`hmr`) |
| `next build` sem `MAPA=1` | ✅ `withMapa(config) === config` (mesmo objeto); build sem nenhuma ocorrência de `__mapa`. A comparação com um build sem `withMapa` difere em 2 arquivos, **os mesmos 2** que diferem entre dois builds idênticos sem o Mapa (manifesto de referências de cliente e um chunk): o build do Next não é determinístico | `out/build-*.sha` |
| Custo de compilação | Turbopack, primeira carga com cache limpo: 1,6 s → 2,5 s (inclui os 54 arquivos do `supabase-js`); webpack: 4,2 s → 4,2 s. Média de 13 ms por arquivo no loader | `out-next.log`, `loader.log` |

**Problemas encontrados e como foram resolvidos no protótipo:**
1. **Server actions não podem usar `this` nem `arguments`** (erro de compilação do Next: "Server Actions cannot use `arguments`"). Solução: em arquivos/funções `"use server"`, o envoltório recebe `...args` e os parâmetros originais vão para a função interna.
2. **O Turbopack guarda em cache o resultado do loader**; mudar o plugin não invalida. No produto: a versão do plugin e o conteúdo do `.mapa/config.json` precisam entrar nas opções do loader (chave do cache) e o config deve ser declarado como dependência.
3. **Quadros do gravador aparecem na pilha de erro** (`runtime-browser.js Object.r`). No produto: marcar o runtime com `ignoreList` no source map para o Next escondê-lo.

---

## Risco 2: pilha assíncrona

**Resposta: funciona, com uma ressalva para bibliotecas no navegador (resolvida).**

### Servidor (`AsyncLocalStorage`)
✅ Todos os `fetch` do servidor ficaram ligados à função e à requisição certas, inclusive passando pelo código interno do `supabase-js`. Exemplos reais:
- `REQ GET /api/hello → route.GET → fetch POST /rest/v1/rpc/calcular_total`
- `REQ POST / → actions.alterarItem → criarClienteServidor → … → fetch PATCH /rest/v1/items`

### Navegador (marcação de `await`)
✅ Com `await` no código do usuário, a pilha é exata, inclusive com duas ações concorrentes. Exemplo que atravessa as três camadas:
`clique → AsyncChain.onClick@26 → passo1 → passo2 → fetch GET /api/hello → REQ GET /api/hello → route.GET → fetch POST /rest/v1/rpc/calcular_total`

A ligação navegador → servidor usa o `traceparent` (só mesma origem) com **trace-id = identificador da carga de página/aba** e parent-id = id do evento.

⚠️ **Ressalva:** o `supabase-js` faz `await getAccessToken()` **dentro de `node_modules`** antes do `fetch` (`fetchWithAuth`), então a pilha se perde ali. Três medições do cenário B:

| Estratégia | `POST /rest/v1/items` ligado a | Classificação |
|---|---|---|
| Só código do usuário | o clique (falta `onClick → adicionarItem`) | ❌ impreciso |
| + inferência ("função suspensa mais recente da mesma ação") | `clique → onClick@30 → adicionarItem` | ✅ correto, marcado como inferido |
| + marcação de `await` em `node_modules/@supabase/` (só marcação, sem gravar funções da biblioteca) | `clique → onClick@30 → adicionarItem` | ✅ **exato**, inclusive com duas ações concorrentes |

**Outros casos encontrados:**
- **`useEffect(() => supabase…then(…))`**, padrão muito comum: o `fetch` ficava **órfão** porque o callback do hook é anônimo. Com a instrumentação dos callbacks de hooks (`Componente.useEffect@linha`), ficou exato: `navegação (carga) → ListaCliente.useEffect@8 → fetch GET /rest/v1/items`.
- **Re-renderizações do React** agendadas por `setState` rodam fora da pilha do clique. Elas foram ligadas à ação aberta mais recente, marcadas como "inferidas".
- **Server action chamada do navegador:** o `fetch POST /` sai de código interno do Next; a inferência acerta (`clique → onClick@35 → fetch POST / → REQ → alterarItem`).

---

## Risco 4: volume e desempenho

### App usável (Turbopack, mediana)
| Medida | Sem Mapa | Com Mapa (gravando) |
|---|---|---|
| Carga da página | 653 ms | 658 ms |
| Cenário B (clique → mensagem na tela) | 83 ms | 83 ms |
| Loop de 10 mil chamadas | 0 ms | 17–22 ms |
| Tecla na lista de 200 itens | 33 ms | 38–50 ms |
| Memória do navegador (heap JS) | 18 MB | 26–28 MB (eventos enviados a cada 500 ms) |

Webpack: carga 1177 → 1178 ms; cenário B 79 → 65 ms; tecla 33 → 47 ms. **O app continua usável** e o recarregamento automático funciona nos dois modos.

### Volume
| Gravação | Eventos | JSON | gzip |
|---|---|---|---|
| Cenário B (1 clique) | 22 | 5 KB | 1 KB |
| Server action (navegador + servidor) | 28 | 6 KB | 1 KB |
| `await` encadeado (navegador + servidor) | 36 | 8 KB | 2 KB |
| Botão do loop (10 mil chamadas) | 20 008 | 4,3 MB | 219 KB |
| **Sessão realista de 2 min** (40 ações: 21 cliques, 13 digitações, 6 navegações; lista de 200 itens) | **112 788** | **27,2 MB** | **1,05 MB** |

Média: **240 bytes por evento** antes de comprimir; o gzip comprime ~25×.

**94% da sessão vem de duas funções repetidas a cada tecla** (`formatarPreco` e `LinhaProduto`, 26 mil chamadas cada), exatamente o caso que o AppMap resolve com refino. Simulação sobre o arquivo gravado:

| Estratégia | Eventos | JSON | gzip | Efeito colateral |
|---|---|---|---|---|
| Sem corte | 112 788 | 27,2 MB | 1,05 MB | — |
| Refino do AppMap (excluir funções com > 75 chamadas) | 1 004 | 0,24 MB | 20 KB | Exclui também `AddItem`, `filtrar`, `ListaGrande`, que importam para entender o app |
| **Teto de 50 chamadas por função dentro de cada ação** | **5 670** | **1,4 MB** | **80 KB** | Cada ação continua completa; só as repetições são cortadas (contadas) |
| Teto de 20 por função por ação | 3 390 | 0,84 MB | 54 KB | idem |

### Limites padrão propostos
| Limite | Valor proposto | Motivo |
|---|---|---|
| Tempo | **2 minutos** (como o CLAUDE.md) | Sessão realista coube com folga |
| Teto por função, por ação | **50 chamadas** (as seguintes só são contadas e registradas no `metadata`, como o `pruneFilter` do AppMap) | Mesmo princípio do corte do AppMap (remover os mais repetidos), aplicado durante a gravação; mantém cada ação completa |
| Eventos | **50 000** | ~9× a sessão realista com teto; ~12 MB |
| Tamanho | **12 MB** de JSON (~0,5 MB comprimido) | Próximo do limite de 10 MB em que o AppMap começa a cortar para abrir |

Pergunta para o dono do projeto: com o teto por função, o **botão do loop deixa de estourar o limite** (10 mil chamadas da mesma função viram 50 + contagem). O critério da Etapa 4 diz "o botão do loop para a gravação pelo limite". Opções: (a) manter o teto e testar a parada por limite com um loop de muitas funções diferentes ou desligando o teto no teste; (b) não ter teto e aceitar que uma sessão como a medida pare em ~25 s.

---

## Outros achados (entram nas próximas etapas)

| Achado | Consequência |
|---|---|
| Ler valores pode ter efeito colateral: resumir as props do layout acessou `params` (Promise no Next 16) e gerou erro "sync dynamic APIs" | O resumo de valores **nunca** acessa thenables nem getters; só objetos simples, com profundidade 1 (implementado em `mapa-proto/summarize.js`) |
| Cada recarga reinicia os ids do navegador; o coletor misturava cargas diferentes | Um identificador por carga de página/aba, usado também como trace-id do `traceparent` |
| Digitação e navegação precisam virar ações (`type` agrupado por campo com intervalo < 1 s; `navigate` na carga e no `pushState`) | Sem isso, só 6 de 40 ações foram reconhecidas; com isso, 40 de 40 |
| Ruídos a filtrar: `__nextjs_original-stack-frames`, `*.hot-update.json` (webpack), `fetch` do próprio Next ao registro do npm (`/-/package/next/dist-tags`), efeitos duplicados do StrictMode | Lista de ignorados no gravador |
| Uma renderização de página no servidor apareceu **sem requisição** (provável validação interna do Next em dev) | Investigar na Etapa 3 |
| `supabase-js` 2.117 tem propagação própria de `traceparent` (`tracePropagation`), **desligada por padrão** | O Mapa não liga; nenhum pedido ao Supabase recebeu `traceparent` nos testes (verificado no servidor falso) |
| `@babel/core` 8 exige Node `^22.18` ou `>=24.11` | Decidir na Etapa 2: Babel 8 (mínimo Node 22.18) ou Babel 7 (aceita Node 22 mais antigo) |

---

## Risco 3: captura dos pedidos do `supabase-js` (navegador e servidor, corpo e resposta)
**Parcial, sem Supabase real.** Contra o servidor falso, os pedidos REST e RPC foram capturados no navegador e no servidor, com método, URL, query string em `message`, corpo (navegador) e resposta. **Pendente:** Supabase real (Auth com sessão, Storage, Edge Function, Realtime/WebSocket) e o papel/id do usuário a partir do token.

## Risco 5: leitura da estrutura pelo endpoint só de leitura
**Pendente:** precisa do projeto de teste e do token da Management API.

## Risco 6: registros (logs) da Edge Function
**Pendente:** precisa do projeto de teste e do token da Management API.
