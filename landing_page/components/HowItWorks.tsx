const P = { margin: 0, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-2)' } as const;
const H3 = { margin: 0, fontSize: 22, fontWeight: 700 } as const;
const CARD = { padding: 28, gap: 14 } as const;

export default function HowItWorks() {
  return (
    <section id="como-funciona" className="section gridpaper bt bb">
      <div className="wrap stack" style={{ gap: 48 }}>
        <div className="head">
          <span className="tag" style={{ color: 'var(--green-text)' }}>Como funciona</span>
          <h2 className="h2">Três passos, <span className="hl-g">sem mudar sua stack.</span></h2>
        </div>
        <div className="auto-3">
          <div className="card card-hover stack" style={{ '--sh': 'var(--blue)', ...CARD } as React.CSSProperties}>
            <div className="num" style={{ background: 'var(--blue-chip)' }}>1</div>
            <h3 style={H3}>Ligue a gravação</h3>
            <p style={P}>Antes de passar pelo fluxo que você quer entender.</p>
          </div>
          <div className="card card-hover stack" style={{ '--sh': 'var(--yellow)', ...CARD } as React.CSSProperties}>
            <div className="num" style={{ background: 'var(--yellow-chip)' }}>2</div>
            <h3 style={H3}>Use o app normalmente</h3>
            <p style={P}>Por baixo, tudo entra na mesma linha do tempo:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="chip c-front">cliques</span>
              <span className="chip c-req">requisições</span>
              <span className="chip c-func">funções</span>
              <span className="chip c-db">banco</span>
            </div>
          </div>
          <div className="card card-hover stack" style={{ '--sh': 'var(--green)', ...CARD } as React.CSSProperties}>
            <div className="num" style={{ background: 'var(--green-chip)' }}>3</div>
            <h3 style={H3}>Pare e receba</h3>
            <p style={P}>O que rodou no seu código vira duas saídas:</p>
            <div className="stack" style={{ gap: 8 }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15 }}><span className="chip c-func">para você</span>o diagrama, passo a passo</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15 }}><span className="chip c-req">para a sua IA</span>o registro para anexar no chat</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
