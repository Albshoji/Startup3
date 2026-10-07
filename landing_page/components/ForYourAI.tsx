import ChatTabs from './ChatTabs';

export default function ForYourAI() {
  return (
    <section className="section">
      <div className="wrap two-col">
        <div className="stack" style={{ gap: 18 }}>
          <span className="tag" style={{ color: 'var(--green-text)' }}>Para a sua IA</span>
          <h2 className="h2">Com o registro, ela para de <span className="hl-g">adivinhar.</span></h2>
          <p className="lead" style={{ fontSize: 18 }}>Anexe o arquivo da sessão na conversa e ela responde sobre o que aconteceu, não sobre suposições.</p>
        </div>
        <ChatTabs />
      </div>
    </section>
  );
}
