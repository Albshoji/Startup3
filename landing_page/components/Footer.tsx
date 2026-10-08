import { PRODUCT_NAME } from '@/lib/site';
import Wordmark from './Wordmark';

export default function Footer() {
  return (
    <footer className="bt" style={{ padding: '36px 0' }}>
      <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 28, height: 28, border: '2px solid var(--ink)', borderRadius: 6, display: 'grid', placeItems: 'center' }}>
            <span className="rec" style={{ width: 9, height: 9, animation: 'none' }}></span>
          </span>
          <Wordmark size={20} />
        </div>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }} aria-label="Rodapé">
          <a className="footlink" href="#como-funciona">Como funciona</a>
          <a className="footlink" href="#perguntas">Perguntas</a>
        </nav>
        <span style={{ fontSize: 14, color: 'var(--muted)' }}>© 2026 {PRODUCT_NAME}. Todos os direitos reservados.</span>
      </div>
    </footer>
  );
}
