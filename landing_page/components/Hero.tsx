import DiagramPreview from './DiagramPreview';
import Mascot from './Mascot';
import WaitlistForm from './WaitlistForm';

export default function Hero() {
  return (
    <section id="topo" className="gridpaper bb" style={{ padding: '88px 0 112px' }}>
      <div className="wrap hero-grid">
        <div className="stack" style={{ gap: 28 }}>
          <div
            style={{
              display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 10,
              padding: '8px 14px 8px 10px', border: '2px solid var(--ink)', borderRadius: 999,
              background: '#fff', fontWeight: 600, fontSize: 14, boxShadow: '3px 3px 0 var(--ink)',
            }}
          >
            <span className="chip c-front" style={{ padding: '4px 8px', borderRadius: 999 }}>Em desenvolvimento</span>
            Acesso antecipado aberto
          </div>
          <h1 className="h1">Use seu app. Entenda o que o seu código fez <span className="hl-y">por trás dos panos.</span></h1>
          <p className="lead" style={{ maxWidth: 560 }}>
            Ligue a gravação e use seu app como sempre. Enquanto você clica, registramos tudo o que o código faz por baixo: as funções chamadas, as requisições, o que chega ao banco. No fim, você recebe duas coisas:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, maxWidth: 560 }}>
            <div className="card card-hover stack" style={{ '--sh': 'var(--green)', padding: '14px 16px', gap: 8 } as React.CSSProperties}>
              <span className="chip c-func" style={{ alignSelf: 'flex-start' }}>para você</span>
              <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>Um diagrama didático que explica cada passo no seu nível.</span>
            </div>
            <div className="card card-hover stack" style={{ '--sh': 'var(--yellow)', padding: '14px 16px', gap: 8 } as React.CSSProperties}>
              <span className="chip c-req" style={{ alignSelf: 'flex-start' }}>para a sua IA</span>
              <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>O registro completo do que rodou, para ela entender também.</span>
            </div>
          </div>
          <WaitlistForm source="hero" />
        </div>

        <div style={{ position: 'relative', padding: '36px 8px 8px 0' }}>
          <Mascot />
          <DiagramPreview />
        </div>
      </div>
    </section>
  );
}
