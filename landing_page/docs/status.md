# Status da landing page

Última atualização: 06/10/2026

## Onde estamos

A página está pronta e igual à referência (`docs/landing-reference.html`, versão de
06/10/2026 22:09, que veio em `landing-claude-code(1).zip`). Ainda não está publicada.

## O que está feito

- Página única em Next.js 16 + TypeScript, com uma seção por arquivo em `components/`.
- Visual comparado pixel a pixel com a referência em 1440px, 1024px e 390px: mesma altura
  em todas. A única diferença é a suavização de borda do ícone "×" da primeira pergunta.
- Interações testadas com mouse e teclado: olhos e falas do mascote, destaque entre os
  termos e as linhas do diagrama, abas do chat, perguntas (só uma aberta por vez).
- Formulários (topo e final) enviando para `/api/waitlist`:
  - e-mail inválido, erro do servidor e sucesso mostram as mensagens certas;
  - e-mail repetido responde sucesso;
  - campo escondido contra robôs: se vier preenchido, nada é salvo;
  - limite de 5 envios por minuto por IP.
- Testado contra um servidor que imita o Supabase (não contra o Supabase de verdade).
- `npm run build` sem erros. Lighthouse: acessibilidade 96, SEO 100, boas práticas 100.
- README com como rodar, criar a tabela e publicar na Vercel.

## O que falta

1. Criar a tabela no Supabase com `supabase/waitlist.sql`.
2. Preencher `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (no `.env.local` e na Vercel) e
   fazer um cadastro de teste de verdade.
3. Publicar na Vercel (Root Directory: `landing_page`).
4. Definir o nome do produto em `lib/site.ts` (`PRODUCT_NAME`, hoje `[Nome do produto]`).
5. Criar a imagem de compartilhamento (Open Graph) e o domínio final (TODO em
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
