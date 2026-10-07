'use client';

import { useState } from 'react';

type Panel = 'sem' | 'com';

const TABS: { id: Panel; label: string }[] = [
  { id: 'sem', label: 'Sem o registro' },
  { id: 'com', label: 'Com o registro' },
];

export default function ChatTabs() {
  const [panel, setPanel] = useState<Panel>('com');

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }} role="group" aria-label="Comparar respostas">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={panel === t.id ? 'tab is-on' : 'tab'}
            type="button"
            aria-pressed={panel === t.id}
            onClick={() => setPanel(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="card stack" style={{ padding: 22, gap: 14, minHeight: 270, boxShadow: '8px 8px 0 var(--ink)' }} aria-live="polite">
        {panel === 'sem' ? (
          <div className="stack" style={{ gap: 14 }}>
            <div className="bubble bubble-me">Meu cadastro não salva.</div>
            <div className="bubble bubble-ai bubble-bad">Pode ser várias coisas: confira a conexão com o banco, os erros no console, as permissões da tabela…</div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <div className="bubble bubble-me stack" style={{ gap: 10 }}>
              <span>Meu cadastro não salva.</span>
              <span className="chip" style={{ alignSelf: 'flex-start', background: '#fff' }}>registro-execucao.json</span>
            </div>
            <div className="bubble bubble-ai bubble-good">
              A função <span className="mono" style={{ fontSize: 14 }}>salvarUsuario</span> tentou gravar o campo <strong>telefone</strong>, que não existe na tabela <span className="mono" style={{ fontSize: 14 }}>usuarios</span>. Por isso o servidor respondeu 500.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
