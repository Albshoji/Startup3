import WaitlistForm from './WaitlistForm';

const DOT = { width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--ink)' } as const;

export default function FinalCTA() {
  return (
    <section id="lista" style={{ padding: '24px 0 112px' }}>
      <div className="wrap">
        <div
          className="gridpaper stack"
          style={{
            border: '2px solid var(--ink)', borderRadius: 12, boxShadow: '12px 12px 0 var(--ink)',
            padding: 'clamp(32px,6vw,64px)', gap: 24, alignItems: 'center', textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 10 }} aria-hidden="true">
            <span style={{ ...DOT, background: 'var(--blue)' }}></span>
            <span style={{ ...DOT, background: 'var(--red)' }}></span>
            <span style={{ ...DOT, background: 'var(--yellow)' }}></span>
            <span style={{ ...DOT, background: 'var(--green)' }}></span>
          </div>
          <h2 className="h2" style={{ maxWidth: 760 }}>Entre na lista e veja seu app <span className="hl-y">por dentro.</span></h2>
          <WaitlistForm source="final" />
        </div>
      </div>
    </section>
  );
}
