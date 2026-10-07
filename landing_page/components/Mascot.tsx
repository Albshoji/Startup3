'use client';

import { useEffect, useRef, useState } from 'react';

const LINES = ['oi!', 'eu explico tudo!', 'grava aí!', 'ei, isso faz cócegas'];

export default function Mascot() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pupilL = useRef<SVGCircleElement>(null);
  const pupilR = useRef<SVGCircleElement>(null);
  const poke = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [speech, setSpeech] = useState<string | null>(null);

  // As pupilas seguem o cursor (até ~5px), atualizando no máximo uma vez por quadro.
  useEffect(() => {
    let raf = 0;
    let pending = { x: 0, y: 0 };
    const onMove = (e: MouseEvent) => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.4);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 160);
      pending = { x: (dx / d) * 5 * k, y: (dy / d) * 5 * k };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          pupilL.current?.setAttribute('cx', String(38 + pending.x));
          pupilR.current?.setAttribute('cx', String(62 + pending.x));
          pupilL.current?.setAttribute('cy', String(40 + pending.y));
          pupilR.current?.setAttribute('cy', String(40 + pending.y));
        });
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function onClick() {
    setSpeech(LINES[poke.current++ % LINES.length]);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setSpeech(null), 1800);
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="mascot"
      aria-label="Mascote: uma folha de caderno com olhos"
      onClick={onClick}
    >
      <svg width="96" height="104" viewBox="0 0 96 104" aria-hidden="true">
        <path d="M14 10 H70 L86 26 V96 H14 Z" fill="#fff" stroke="#1f1f1f" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M70 10 V26 H86" fill="#e8f0fe" stroke="#1f1f1f" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="24" y1="64" x2="76" y2="64" stroke="#aecbfa" strokeWidth="2" />
        <line x1="24" y1="74" x2="76" y2="74" stroke="#aecbfa" strokeWidth="2" />
        <line x1="24" y1="84" x2="64" y2="84" stroke="#aecbfa" strokeWidth="2" />
        <line x1="22" y1="14" x2="22" y2="94" stroke="#f6aea9" strokeWidth="2" />
        <g className="blink">
          <circle cx="38" cy="40" r="11" fill="#fff" stroke="#1f1f1f" strokeWidth="2.5" />
          <circle cx="62" cy="40" r="11" fill="#fff" stroke="#1f1f1f" strokeWidth="2.5" />
          <circle ref={pupilL} cx="38" cy="40" r="4.5" fill="#1f1f1f" />
          <circle ref={pupilR} cx="62" cy="40" r="4.5" fill="#1f1f1f" />
        </g>
        <path d="M44 55 Q50 60 56 55" fill="none" stroke="#1f1f1f" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {speech && <span className="speech hand">{speech}</span>}
    </button>
  );
}
