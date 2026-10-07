const H3 = { margin: '0 0 10px', fontSize: 24, fontWeight: 700 } as const;
const P = { margin: 0, fontSize: 18, lineHeight: 1.6, color: 'var(--ink-2)' } as const;

export default function Audience() {
  return (
    <section className="section gridpaper bt bb" style={{ padding: '96px 0' }}>
      <div className="wrap stack" style={{ gap: 48 }}>
        <div className="head">
          <span className="tag" style={{ color: 'var(--blue-text)' }}>Para quem é</span>
          <h2 className="h2">Para quem constrói com IA e <span className="hl-b">não escreveu cada linha.</span></h2>
          <p className="lead" style={{ maxWidth: 760 }}>A explicação da IA não faz sentido para você, e você quer aprender o conhecimento técnico que falta para entender o seu repositório. <span className="hl-y">Só o necessário, sem fazer um curso inteiro.</span></p>
        </div>
        <div className="auto-2">
          <div className="note rot-l">
            <span className="tape" style={{ background: 'rgba(52,168,83,.35)' }}></span>
            <h3 style={H3}>Desenvolvedor júnior</h3>
            <p style={P}>Entrou num projeto que não escreveu e não quer perguntar tudo ao time. Num bug, a IA sugere correções às cegas.</p>
          </div>
          <div className="note rot-r">
            <span className="tape" style={{ background: 'rgba(234,67,53,.3)' }}></span>
            <h3 style={H3}>Vibe coder</h3>
            <p style={P}>Entrega com IA, mas o código é uma caixa preta. Quando algo quebra, a IA entra no loop de “corrige aqui, quebra ali”.</p>
          </div>
        </div>
        <p className="hand" style={{ margin: 0, fontSize: 26, color: 'var(--muted)' }}>Já domina o seu repositório? Então isso não é para você.</p>
      </div>
    </section>
  );
}
