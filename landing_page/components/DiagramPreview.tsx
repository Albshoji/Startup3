import SwimlaneDiagram, { type SwimEdge, type SwimLane, type SwimNode } from './SwimlaneDiagram';

// Illustrative example built only from what Mapa records: functions with file:line,
// requests, the Supabase request translated (with the role of who asked), the access
// rule (RLS) read from the database structure, and what came back.
const LANES: SwimLane[] = [
  { label: 'navegador', color: '#d2e3fc' },
  { label: 'servidor Next', color: '#ceead6' },
  { label: 'Supabase API', color: '#feefc3' },
  { label: 'banco', color: '#fad2cf' },
];

const NODES: SwimNode[] = [
  { lane: 0, row: 0, title: 'GET /itens', code: 'navegação' },
  { lane: 1, row: 1, title: 'ItensPage()', code: 'page.tsx:8' },
  { lane: 1, row: 2, title: 'createClient()', code: 'lib/db.ts:4' },
  { lane: 2, row: 3, title: 'GET /items', code: 'papel: anon' },
  { lane: 3, row: 4, title: 'SELECT items', code: 'RLS filtrou', variant: 'fail' },
  { lane: 1, row: 5, title: '200 OK · [ ]', code: 'error: null' },
  { lane: 0, row: 6, title: '“Nenhum item”', code: 'page.tsx:15', variant: 'dim' },
];

const EDGES: SwimEdge[] = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 4 },
  { from: 4, to: 5, route: 'vh', fail: true, dashed: true },
  { from: 5, to: 6, route: 'vh', dashed: true },
];

export default function DiagramPreview() {
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
          nodes={NODES}
          edges={EDGES}
          notes={[
            { left: 6, top: 160, lines: ['sem o cookie', 'da sessão →'] },
            { left: 296, top: 404, lines: ['sem erro.', 'só veio vazio.'] },
          ]}
          label="Diagrama: o servidor consultou o Supabase sem a sessão, como anon, e a regra RLS escondeu todas as linhas"
        />
        <div className="swhy">
          <span className="lbl">Por que quebrou</span>
          O <code>createClient()</code> do servidor foi criado <b>sem o cookie da sessão</b>, então o pedido chegou ao Supabase como <b>anon</b> (ninguém logado). A regra de acesso (<b>RLS</b>) da tabela <code>items</code> só mostra linhas com <code>owner_id = auth.uid()</code>. Para anon, nenhuma: veio <b>[ ]</b>, sem erro.
          <span className="sfrom">
            <span className="chip c-func">confirmado pela gravação</span>
            <span className="chip c-db">configurado no banco</span>
          </span>
        </div>
      </div>
    </div>
  );
}
