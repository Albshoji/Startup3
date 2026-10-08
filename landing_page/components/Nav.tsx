import Wordmark from './Wordmark';

export default function Nav() {
  return (
    <header className="topbar">
      <div className="wrap">
        <a href="#topo" className="brand">
          <span className="logo" aria-hidden="true">
            <span className="rec" style={{ width: 12, height: 12 }}></span>
            <i style={{ left: 5, bottom: 5, background: 'var(--blue)' }}></i>
            <i style={{ right: 5, top: 5, background: 'var(--yellow)' }}></i>
            <i style={{ right: 5, bottom: 5, background: 'var(--green)' }}></i>
          </span>
          <Wordmark />
        </a>
        <nav className="nav-links" aria-label="Seções">
          <a className="navlink" href="#como-funciona">Como funciona</a>
          <a className="navlink" href="#perguntas">Perguntas</a>
        </nav>
        <a className="btn btn-blue btn-sm" href="#lista">Entrar na lista</a>
      </div>
    </header>
  );
}
