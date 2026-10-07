import SwimlaneDiagram, { type SwimEdge, type SwimLane, type SwimNode } from './SwimlaneDiagram';

const LANES: SwimLane[] = [
  { label: 'navegador', color: '#d2e3fc' },
  { label: 'seu servidor', color: '#ceead6' },
  { label: 'Stripe', color: '#feefc3' },
  { label: 'banco', color: '#fad2cf' },
];

const NODES: SwimNode[] = [
  { lane: 0, row: 0, label: 'Clicou em “Assinar”' },
  { lane: 1, row: 1, label: 'Criou o checkout' },
  { lane: 2, row: 2, label: 'Pagamento aprovado' },
  { lane: 0, row: 3, label: 'Mostrou “Pago”' },
  { lane: 1, row: 4, label: 'Webhook chegou' },
  { lane: 3, row: 5, label: 'Atualizou 0 linhas', variant: 'fail' },
  { lane: 0, row: 6, label: 'Plano segue “Free”', variant: 'dim' },
];

const EDGES: SwimEdge[] = [
  { d: 'M114.0 68.0 H169.0 Q177.0 68.0 177.0 76.0 V99' },
  { d: 'M232.0 130.0 H287.0 Q295.0 130.0 295.0 138.0 V161' },
  { d: 'M240.0 192.0 H67.0 Q59.0 192.0 59.0 200.0 V223' },
  { d: 'M295.0 216 V308.0 Q295.0 316.0 287.0 316.0 H239.0' },
  { d: 'M177.0 340 V370.0 Q177.0 378.0 185.0 378.0 H351.0', variant: 'fail' },
  { d: 'M413.0 402 V432.0 Q413.0 440.0 405.0 440.0 H121.0', variant: 'dashed' },
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
          Diagrama · por que meu plano continua Free?
        </span>
      </div>
      <div style={{ padding: '18px 16px 18px' }}>
        <SwimlaneDiagram
          lanes={LANES}
          nodes={NODES}
          edges={EDGES}
          notes={[{ left: 348, top: 304, lines: ['sem erro.', 'nada salvo.'] }]}
          label="Diagrama: o pagamento foi aprovado, mas o banco atualizou 0 linhas"
        />
        <div className="swhy">
          <span className="lbl">Por que quebrou</span>
          O Stripe chama seu webhook <b>sem usuário logado</b>. A regra do banco (<b>RLS</b>) só deixa cada usuário editar <b>a própria linha</b>, então o update afetou <b>0 linhas</b>: sem erro, nada salvo.
        </div>
      </div>
    </div>
  );
}
