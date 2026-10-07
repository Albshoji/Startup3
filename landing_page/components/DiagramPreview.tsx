'use client';

import { useState } from 'react';
import SwimlaneDiagram, { type SwimEdge, type SwimLane, type SwimNode } from './SwimlaneDiagram';

// Illustrative example built only from what Mapa records: functions with file:line,
// requests, the Supabase request translated (with the role of who asked), the access
// rule (RLS) read from the database structure, and what came back. Each step has a
// plain title, the real name in the code and a short explanation, as in the product.
type Step = SwimNode & { detail: string; real: string; certainty: 'recording' | 'schema' };

const LANES: SwimLane[] = [
  { label: 'navegador', color: '#d2e3fc' },
  { label: 'seu servidor', color: '#ceead6' },
  { label: 'Supabase', color: '#feefc3' },
  { label: 'banco', color: '#fad2cf' },
];

const STEPS: Step[] = [
  {
    lane: 0, row: 0, title: 'Pediu a página', code: 'GET /itens', certainty: 'recording',
    real: 'GET /itens',
    detail: 'O navegador pediu a página /itens ao seu servidor. Isso é uma requisição HTTP do tipo GET: ela só pede, não envia dados.',
  },
  {
    lane: 1, row: 1, title: 'Montou a página', code: 'ItensPage()', certainty: 'recording',
    real: 'app/itens/page.tsx:8 · ItensPage()',
    detail: 'A função ItensPage() começou a montar a página. Ela é um Server Component: roda no servidor, antes de a página chegar ao navegador.',
  },
  {
    lane: 1, row: 2, title: 'Conectou ao Supabase', code: 'createClient()', certainty: 'recording',
    real: 'lib/db.ts:4 · createClient()',
    detail: 'A função createClient() criou o cliente do Supabase, a peça que faz os pedidos ao banco. Ele foi criado sem o cookie da sessão, que é o que diz quem está logado. Sem ele, o Supabase não sabe que é você.',
  },
  {
    lane: 2, row: 3, title: 'Pedido chegou sem login', code: 'papel: anon', certainty: 'recording',
    real: 'GET /rest/v1/items · papel: anon',
    detail: 'O pedido chegou ao Supabase com o papel anon, que é como o Supabase chama quem não está logado. Você estava logado no navegador, mas essa informação ficou para trás no passo 3.',
  },
  {
    lane: 3, row: 4, title: 'Regra escondeu tudo', code: 'RLS · items', certainty: 'schema', variant: 'fail',
    real: 'política “items: dono vê” · owner_id = auth.uid()',
    detail: 'A tabela items tem uma regra de acesso (RLS): cada pessoa só vê as linhas em que owner_id é o próprio id. Quem está como anon não tem id, então a regra escondeu todas. Isso não quer dizer que a tabela está vazia.',
  },
  {
    lane: 1, row: 5, title: 'Recebeu lista vazia', code: '200 OK · [ ]', certainty: 'recording',
    real: 'resposta 200 · data: [ ] · error: null',
    detail: 'O Supabase respondeu 200 (sucesso) com uma lista vazia e sem erro. Para o código, deu tudo certo. Por isso nenhuma mensagem de erro apareceu.',
  },
  {
    lane: 0, row: 6, title: 'Mostrou lista vazia', code: 'page.tsx:15', certainty: 'recording', variant: 'dim',
    real: 'app/itens/page.tsx:15',
    detail: 'Com a lista vazia, a página mostrou a mensagem “Nenhum item”. É o que você viu na tela.',
  },
];

const EDGES: SwimEdge[] = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 4 },
  { from: 4, to: 5, route: 'vh', fail: true, dashed: true },
  { from: 5, to: 6, route: 'vh', dashed: true },
];

const CERTAINTY = {
  recording: { label: 'confirmado pela gravação', className: 'c-func' },
  schema: { label: 'configurado no banco', className: 'c-db' },
} as const;

export default function DiagramPreview() {
  const [selected, setSelected] = useState<number | null>(null);
  const step = selected === null ? null : STEPS[selected];

  return (
    <div className="window">
      <div className="win-bar">
        <span className="dot" style={{ background: 'var(--red)' }}></span>
        <span className="dot" style={{ background: 'var(--yellow)' }}></span>
        <span className="dot" style={{ background: 'var(--green)' }}></span>
        <span
          style={{
            marginLeft: 10, marginRight: 88, fontSize: 13, fontWeight: 700, color: 'var(--ink-2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
          }}
        >
          Diagrama · por que minha lista veio vazia?
        </span>
      </div>
      <div style={{ padding: '18px 16px 18px' }}>
        <SwimlaneDiagram
          lanes={LANES}
          nodes={STEPS}
          edges={EDGES}
          selected={selected}
          onSelect={(i) => setSelected(i === selected ? null : i)}
          notes={[
            { left: 4, top: 190, lines: ['o problema', 'nasce aqui →'] },
            { left: 296, top: 472, lines: ['sem erro.', 'só veio vazio.'] },
          ]}
          label="Diagrama em 7 passos de por que a lista veio vazia. Escolha um passo para ver a explicação."
        />
        <div className="swhy" aria-live="polite">
          {step ? (
            <>
              <span className="lbl">Passo {selected! + 1} · {step.title}</span>
              {step.detail}
              <span className="sreal">{step.real}</span>
              <span className="sfrom">
                <span className={`chip ${CERTAINTY[step.certainty].className}`}>{CERTAINTY[step.certainty].label}</span>
                <button type="button" className="sback" onClick={() => setSelected(null)}>ver o resumo</button>
              </span>
            </>
          ) : (
            <>
              <span className="lbl">Por que quebrou</span>
              Seu servidor conectou ao Supabase <b>sem dizer quem estava logado</b> (passo 3). Sem login, a <b>regra de acesso (RLS)</b> da tabela esconde todas as linhas (passo 5). Por isso a lista veio vazia, <b>sem nenhum erro</b>.
              <span className="shint">Toque em um passo para ver a explicação.</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
