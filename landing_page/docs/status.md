# Status da landing page

Última atualização: 07/10/2026

## Onde estamos

A página está pronta e igual à referência (`docs/landing-reference.html`, versão de
07/10/2026 08:42, que veio em `landing-claude-code.zip`). Ainda não está publicada.

## O que está feito

- Página única em Next.js 16 + TypeScript, com uma seção por arquivo em `components/`.
- Diagrama do topo mostra o que o Mapa de fato grava por baixo, no formato combinado para
  o produto: cada passo tem um título em português simples ("Conectou ao Supabase") e,
  embaixo, o nome real no código (`createClient()`). Passar o mouse num passo mostra um
  balão ao lado com a explicação e o grau de certeza. Clicar num passo mostra a explicação
  dele (com o nome do conceito técnico, ex.: "regra de acesso (RLS)"), a referência
  completa (arquivo:linha, pedido, regra) e o grau de certeza ("confirmado pela gravação"
  ou "configurado no banco"). Sem passo escolhido, o quadro mostra o resumo "O que
  aconteceu". O diagrama não diz o que é erro: ele mostra o que rodou (o Mapa não sabe o
  que o usuário esperava). Só usa informações que o Mapa já consegue obter (cenário C da Etapa 7).
  Feito pelo componente `SwimlaneDiagram` (colunas, passos e ligações como dados; desenha
  as setas sozinho). Em telas estreitas o diagrama diminui inteiro para caber.
  **Esse diagrama é diferente da referência de propósito** (decisão do dono, 07/10).
- Visual comparado com a referência em 1440px, 1024px e 390px. Diferenças só de largura
  de letra (arquivos de fonte diferentes, ver abaixo): por exemplo, "Atualizou 0 linhas"
  quebra a linha num ponto diferente.
- Interações testadas com mouse e teclado: olhos e falas do mascote, destaque entre os
  termos e as linhas do diagrama, abas do chat, perguntas (só uma aberta por vez).
- Formulários (topo e final) enviando para `/api/waitlist`:
  - e-mail inválido, erro do servidor e sucesso mostram as mensagens certas;
  - e-mail repetido responde sucesso;
  - campo escondido contra robôs: se vier preenchido, nada é salvo;
  - limite de 5 envios por minuto por IP.
- Lista de espera no Supabase de verdade: tabela `waitlist` no projeto **`mapa-site`** (o
  mesmo do site do Mapa), criada pela migração `main_app/supabase/migrations/20261007000001_waitlist.sql`.
  `landing_page/.env.local` (fora do Git) tem o endereço e a chave secreta desse projeto.
  Testado em 07/10: cadastro salvo, e-mail repetido responde sucesso, ninguém consegue ler a
  lista sem a chave secreta. O e-mail de teste foi apagado. Para ver os cadastros: painel do
  Supabase → projeto `mapa-site` → Table Editor → `waitlist`.
- `npm run build` sem erros. Lighthouse: acessibilidade 96, SEO 100, boas práticas 100.
- README com como rodar, criar a tabela e publicar na Vercel.

## O que falta

1. Colocar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` na Vercel (os mesmos do
   `.env.local`, que é o projeto `mapa-site`).
2. Publicar na Vercel (Root Directory: `landing_page`).
3. Criar a imagem de compartilhamento (Open Graph) e o domínio final (TODO em
   `app/layout.tsx`).

## Pontos em aberto

- A frase "passe o mouse nas palavras sublinhadas →" tem contraste 4,27 (o mínimo
  recomendado é 4,5). É a cor da referência; não mudei. É o único item reprovado no
  Lighthouse.
- No Windows e no Linux, algumas linhas podem quebrar em lugar um pouco diferente da
  referência, porque o Google entrega arquivos de fonte diferentes conforme o sistema.
  Com o mesmo arquivo de fonte, as duas ficam idênticas.

## Histórico

- 06/10/2026 — Primeira versão da página (commit `668b1ae`).
- 06/10/2026 — Instruções atualizadas: novo título e descrição, novo título principal, novo
  texto do cartão "para você" e a etiqueta "o problema nasce aqui" no passo 4. Essas mudanças
  entraram no commit `a6d97d4` (junto com a Etapa 7 do `main_app`); este arquivo de status,
  no `3e089fc`.
- 07/10/2026 — Nova versão das instruções: novo título e descrição do site, novo título
  principal ("Use seu app. Entenda o que o seu código fez por trás dos panos."), diagrama
  do topo trocado pelo exemplo do pagamento com o Stripe e novo parágrafo na seção
  "Para quem é" (commit `10f3f4b`).
- 07/10/2026 — Diagrama do topo trocado: no lugar do exemplo do Stripe (que mostrava as
  ações do usuário), um exemplo do que o Mapa grava por baixo: lista vazia porque o
  servidor consultou o Supabase sem a sessão e a regra RLS escondeu as linhas (commit `6c00a73`).
- 07/10/2026 — Diagrama do topo ficou mais acessível: títulos em português simples com o
  nome técnico embaixo, e explicação de cada passo ao clicar (commit `290553c`).
- 07/10/2026 — Balão com a explicação ao passar o mouse sobre cada passo do diagrama
  (commit `da9c6d1`).
- 07/10/2026 — Tirada a promessa de que o diagrama aponta o erro: cartão "para você" do
  topo, título do diagrama, passo em vermelho, anotação "o problema nasce aqui" e quadro
  "Por que quebrou" (agora "O que aconteceu") (commit `0ca1e45`).
- 07/10/2026 — Título principal e título do site: "Entenda o que…" virou "Aprenda o que…" (commit `45f80a8`).
- 07/10/2026 — Seção de comparação: tirada a frase sobre os termos técnicos; fica só "O diagrama conta o que foi gravado, não o que provavelmente aconteceu."
- 07/10/2026 — Nome do produto definido: **Undercode** (menu, rodapé e título do site).
- 07/10/2026 — Nome desenhado como logotipo no menu e no rodapé: "under" + "code" (fonte de código, azul) + cursor vermelho piscando (`components/Wordmark.tsx`).
- 07/10/2026 — Lista de espera ligada ao Supabase de verdade (projeto `mapa-site`) e testada.
- 07/10/2026 — Domínios pesquisados: undercode.com, .com.br, .ai, .io, .dev, .co, .org, .me e
  .tech já têm dono; undercode.app, getundercode.com, useundercode.com e undercodehq.com
  pareciam livres (conferir no registrador antes de comprar).
