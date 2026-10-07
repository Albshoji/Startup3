import ComparisonCards from './ComparisonCards';

export default function Comparison() {
  return (
    <section className="section">
      <div className="wrap stack" style={{ gap: 48 }}>
        <div className="head">
          <span className="tag" style={{ color: 'var(--red-text)' }}>Por que isso existe</span>
          <h2 className="h2">A IA explica o código sem saber o que aconteceu. E como se você <span className="hl-b">já soubesse.</span></h2>
        </div>
        <ComparisonCards />
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 800 }}>
          <strong>O diagrama conta o que foi gravado, não o que provavelmente aconteceu.</strong>
        </p>
      </div>
    </section>
  );
}
