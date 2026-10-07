type Step = { chip: string; chipClass: string; title: string; code: string; fail?: boolean };

const STEPS: Step[] = [
  { chip: 'front', chipClass: 'c-front', title: 'Você clicou em “Criar conta”', code: 'components/FormCadastro.tsx · onSubmit()' },
  { chip: 'requisição', chipClass: 'c-req', title: 'O app enviou os dados ao servidor', code: 'fetch("/api/cadastro", { method: "POST" })' },
  { chip: 'função', chipClass: 'c-func', title: 'A rota chamou salvarUsuario()', code: 'app/api/cadastro/route.ts · salvarUsuario()' },
  { chip: 'banco', chipClass: 'c-db', title: 'O banco recusou a escrita', code: 'supabase.from("usuarios").insert(...)', fail: true },
  { chip: 'resposta', chipClass: 'c-req', title: 'O servidor respondeu 500', code: 'route.ts → status 500' },
];

export default function DiagramPreview() {
  return (
    <div className="window">
      <div className="win-bar">
        <span className="dot" style={{ background: 'var(--red)' }}></span>
        <span className="dot" style={{ background: 'var(--yellow)' }}></span>
        <span className="dot" style={{ background: 'var(--green)' }}></span>
        <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>
          Diagrama · por que o cadastro não salvou
        </span>
      </div>
      <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: '18px 20px 20px' }}>
        {STEPS.map((s, i) => (
          <li key={s.title} className="hstep-wrap">
            <div className={s.fail ? 'hstep is-fail' : 'hstep'}>
              <span className="step-num">{i + 1}</span>
              <span className="stack" style={{ gap: 6, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`chip ${s.chipClass}`}>{s.chip}</span>
                  <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{s.title}</span>
                </span>
                <span className="mono hcode">{s.code}</span>
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="harrow" aria-hidden="true">
                <svg width="14" height="16" viewBox="0 0 14 16">
                  <path className="doodle-thin" d="M7 1 V13 M2 8 L7 14 L12 8" style={{ stroke: '#9aa0a6' }} />
                </svg>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
