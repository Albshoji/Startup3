'use client';

import { useState } from 'react';

const ITEMS = [
  { q: 'Quando fica pronto?', a: 'Está em desenvolvimento. Quem está na lista recebe acesso antes e fica sabendo da data primeiro.' },
  { q: 'Vai funcionar no meu app?', a: 'A meta é funcionar sem você reescrever nada. Conte sua stack ao entrar na lista: ela entra na nossa prioridade.' },
  { q: 'Deixa meu app mais lento?', a: 'A gravação só roda quando você liga. Fora dela, nada muda no seu app.' },
  { q: 'Vai ser pago?', a: 'Ainda estamos definindo. Entrar na lista é grátis, e quem está nela fica sabendo do preço antes.' },
  { q: 'O que vocês fazem com meu e-mail?', a: 'Só avisamos sobre o acesso. Você sai da lista quando quiser.' },
];

export default function FAQ() {
  // Só uma pergunta aberta por vez; a primeira começa aberta.
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="perguntas" className="section">
      <div className="wrap" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 48, alignItems: 'start' }}>
        <div className="head">
          <span className="tag" style={{ color: 'var(--red-text)' }}>Perguntas</span>
          <h2 className="h2">Antes de entrar na lista</h2>
        </div>
        <div className="stack" style={{ gap: 12 }} id="faq">
          {ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className={isOpen ? 'faq is-open' : 'faq'}>
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <span className="plus" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 14 14"><path className="doodle-thin" d="M7 2 V12 M2 7 H12" /></svg>
                  </span>
                </button>
                <p className="faq-a" id={`faq-a-${i}`} hidden={!isOpen}>{item.a}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
