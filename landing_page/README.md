# Landing page — lista de espera

Página única em Next.js (App Router + TypeScript) que reproduz `docs/landing-reference.html`
e salva os e-mails da lista de espera no Supabase.

## Rodar no seu computador

Precisa do Node.js 20 ou mais novo.

```bash
npm install
cp .env.example .env.local   # depois preencha as duas variáveis
npm run dev                  # abre em http://localhost:3000
```

Sem as variáveis a página abre normalmente, mas o envio do formulário mostra
"Algo deu errado. Tente de novo?".

## Variáveis de ambiente

| Variável | Onde achar no Supabase |
| --- | --- |
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → chave `service_role` |

A chave `service_role` só é usada no servidor (`app/api/waitlist/route.ts`). Nunca coloque
o prefixo `NEXT_PUBLIC_` nela: isso a enviaria para o navegador.

## Criar a tabela

No painel do Supabase, abra **SQL Editor**, cole o conteúdo de `supabase/waitlist.sql` e
clique em **Run**. A tabela fica bloqueada para o navegador (RLS ligado, sem políticas
públicas); só o servidor grava nela.

Para ver quem entrou na lista: **Table Editor → waitlist**.

## Publicar na Vercel

1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel, **Add New → Project** e escolha o repositório. Se a pasta não estiver na raiz
   do repositório, ajuste **Root Directory** para `landing_page`.
3. Em **Environment Variables**, adicione `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
4. Clique em **Deploy**.

## Comandos

- `npm run dev` — servidor de desenvolvimento
- `npm run build` — build de produção (também confere os tipos)
- `npm run start` — roda o build de produção

## Onde mexer

- Nome do produto: `lib/site.ts` (`PRODUCT_NAME`). Aparece no menu, no rodapé e no título.
- Estilos: `app/globals.css` (as cores ficam nas variáveis do `:root`).
- Seções: uma por arquivo em `components/`.
- Imagem de compartilhamento (Open Graph): ainda falta; ver o TODO em `app/layout.tsx`.

## Proteções do formulário

- Validação no servidor: e-mail com no máximo 254 caracteres, stack com no máximo 120.
- E-mail repetido responde sucesso, para não revelar quem já está na lista.
- Campo escondido (honeypot): se um robô preencher, a resposta é sucesso e nada é salvo.
- Limite de 5 envios por minuto por IP. Fica na memória de cada instância do servidor, então
  é uma proteção básica, não absoluta.
