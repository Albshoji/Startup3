# Landing page — lista de espera

## Your task

Build this landing page as a real, deployable website. The design is final: reproduce
`reference/landing-reference.html` **exactly** (layout, copy, colors, fonts, spacing,
interactions). Open it in a browser first; it is the source of truth. Whenever this file
and the reference disagree on how something looks, the reference wins.

Do not add sections, rewrite copy or "improve" the design. If something seems wrong, ask
before changing it.

## Product context (so the copy makes sense)

The product records what happens inside the developer's own app while they use it
(front-end events, requests, functions that ran, database operations) and turns the
session into two outputs:

1. **For the developer:** a didactic diagram that explains each step at their level,
   using the real terms found in the code, explained in context.
2. **For their AI:** the full execution record, to attach in the chat so the AI stops
   guessing.

Audience: junior developers and "vibe coders" who build with AI and don't fully
understand their own code. The page's only goal is to **get people onto the waitlist**.
The product itself does not exist yet: this site is only the landing page.

## Stack

- **Next.js (App Router) + TypeScript**, deployable on Vercel.
- **Plain CSS** ported from the reference (`app/globals.css` + CSS modules if you prefer).
  Keep the same CSS variables in `:root`. Do not switch to Tailwind or a UI kit: the look
  depends on the exact values.
- **Fonts:** load IBM Plex Sans (400/500/600/700), IBM Plex Mono (500/600) and Caveat
  (600/700) with `next/font/google`.
- **Supabase** for the waitlist (schema in `supabase/waitlist.sql`).

## Structure

- One page (`app/page.tsx`), split into one component per section:
  `Nav`, `Hero` (with `Mascot` and `DiagramPreview`), `Comparison`, `HowItWorks`,
  `ForYourAI`, `Audience`, `FAQ`, `FinalCTA`, `Footer`, and a shared `WaitlistForm`.
- Static parts stay Server Components; only the interactive pieces are Client Components
  (`'use client'`): Mascot, DiagramPreview, Comparison highlight, chat tabs, FAQ,
  WaitlistForm.
- Put the product name in a single constant (`lib/site.ts` → `PRODUCT_NAME`), used in the
  nav, the footer and the metadata. It is still `[Nome do produto]`.

## Interactions to reproduce (all are in the reference's `<script>`)

1. **Mascot (hero):** the notebook page's pupils follow the cursor (max ~5px offset,
   throttled with `requestAnimationFrame`). It blinks every 5s (CSS). Clicking it shows a
   speech bubble that cycles through: "oi!", "eu explico tudo!", "grava aí!",
   "ei, isso faz cócegas", and hides after 1.8s. It is a real `<button>`.
2. **Diagram preview (hero):** a swimlane diagram with 4 lanes (navegador, seu servidor,
   Supabase, banco) and 7 numbered steps connected by elbow arrows (calls go down,
   returns come back dashed). It shows what Mapa really records, not what the user did,
   in the product's format: each step has a **plain title** ("Conectou ao Supabase") and
   the **real name** in the code below it (`createClient()`). Hovering or focusing a step shows a tooltip beside
   it with that step's explanation and certainty tag. Steps are buttons: clicking
   one replaces the box under the diagram with that step's explanation (names the
   technical concept, e.g. "regra de acesso (RLS)"), the full technical reference
   (file:line, request, policy) and its certainty tag ("confirmado pela gravação" or
   "configurado no banco"); "ver o resumo" (or clicking the step again) goes back to the
   "O que aconteceu" summary. Handwritten note "sem erro. só veio vazio.".
   **The diagram does not judge what is an error:** Mapa records and explains what ran;
   it cannot know what the user expected. No step is marked as "the problem", and the
   copy never says the diagram points out where it broke (only errors actually returned
   by the code or the database, like 42703 in the comparison section, are shown as errors). Built by the reusable
   `SwimlaneDiagram` component: lanes, nodes and edges (from/to) as data; it routes the
   arrows itself. On narrow windows the whole diagram scales down to fit; it never
   scrolls sideways.
   **This diagram intentionally differs from `reference/landing-reference.html`**
   (changed by the owner on 07/10/2026); the code is the source of truth for it.
3. **Comparison:** hovering or focusing an underlined term on the left (`.jargon`)
   highlights the matching row on the right (`.trow`, `data-row`) and dims the others.
   Hovering a row highlights its terms on the left. "client" and "insert" both map to
   row 3 (zero-based); "schema cache" maps to row 4.
4. **Chat tabs ("Sem o registro" / "Com o registro"):** toggle buttons with
   `aria-pressed`. "Com o registro" starts selected.
5. **FAQ:** accordion, only one open at a time, first one open by default,
   `aria-expanded` kept in sync.
6. **Hover states:** cards lift with a hard colored shadow, buttons rise and press down,
   sticky notes straighten. All defined in CSS.
7. `prefers-reduced-motion` disables animations (already in the CSS).

## Waitlist (the only backend)

Both forms (hero: e-mail only; final CTA: e-mail + optional "Qual stack você usa?")
submit to the same endpoint.

- Create the table with `supabase/waitlist.sql`.
- `app/api/waitlist/route.ts` (POST, JSON `{ email, stack?, source: 'hero' | 'final' }`):
  - Validate on the server (trim, lowercase, basic e-mail regex, max lengths:
    e-mail 254, stack 120).
  - Insert with the Supabase **service role key**, used only on the server. Never expose
    it to the browser.
  - If the e-mail already exists, return success anyway (don't reveal who is on the list).
  - Add a hidden honeypot field to both forms. If it is filled, return 200 and store
    nothing.
  - Add simple rate limiting per IP (for example, 5 requests per minute in memory).
- **Form states** (copy is final):
  - Invalid e-mail (client-side, before sending): "Esse e-mail não parece certo. Confere?"
  - Sending: disable the button.
  - Success: replace the fields with "Pronto, você está na lista. Avisamos assim que o
    acesso abrir."
  - Network or server error: "Algo deu errado. Tente de novo?" (keep the fields).
- Environment variables, documented in `.env.example`:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## SEO and metadata

- `lang="pt-BR"`.
- Title: `[Nome do produto] — entenda o que seu código fez por trás dos panos`.
- Description: "Ligue a gravação, use seu app e receba um diagrama didático do que rodou no
  seu código, além de um registro completo para a sua IA."
- Open Graph and Twitter tags with the same text. Leave a TODO for the OG image.
- Favicon: a simple SVG of the logo (a rounded square with a red dot).

## Done when

- [ ] Side by side with the reference at 1440px, 1024px and 390px, it looks the same.
- [ ] No horizontal scroll at 390px. The nav links hide below 820px, as in the reference.
- [ ] Every interaction in the list above works, and also with the keyboard
      (focus states visible).
- [ ] Both forms save to Supabase. A duplicate e-mail still shows success. Invalid e-mail
      and server error show the right messages.
- [ ] `npm run build` passes with no type errors. Lighthouse accessibility score ≥ 95.
- [ ] A short README explains how to run it locally, set the env vars, create the table
      and deploy to Vercel.

## Notes

- The diagram and chat content is an **illustrative example**. Keep it exactly as written.
  The hero diagram ("Diagrama · abrir a página /itens") uses the empty-list example (server client created without the
  session cookie, request as `anon`, RLS hides every row). The comparison section and the "Para a sua IA" chat use the signup example
  (`salvarUsuario`, coluna `telefone`, erro 42703).
- All copy is in Brazilian Portuguese. Keep the curly quotes (“ ”) and the ellipses (…)
  as they are.
