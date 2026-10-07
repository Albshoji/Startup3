'use client';

import { useState, type ReactNode } from 'react';

const ROW_TEXT = { fontSize: 15, lineHeight: 1.6, minWidth: 0 } as const;
const CHIP_TOP = { alignSelf: 'flex-start' } as const;

type JargonProps = { row: number; active: number | null; onActive: (row: number | null) => void; children: ReactNode };

// Termo sublinhado do lado esquerdo: ao passar o mouse ou focar, acende a linha `row` do diagrama.
function Jargon({ row, active, onActive, children }: JargonProps) {
  return (
    <span
      className={active === row ? 'jargon j-on' : 'jargon'}
      tabIndex={0}
      onMouseEnter={() => onActive(row)}
      onFocus={() => onActive(row)}
      onMouseLeave={() => onActive(null)}
      onBlur={() => onActive(null)}
    >
      {children}
    </span>
  );
}

export default function ComparisonCards() {
  // Linha do diagrama em destaque (null = nenhuma).
  const [active, setActive] = useState<number | null>(null);

  const j = { active, onActive: setActive };

  const rowClass = (row: number, extra = '') => {
    const state = active === null ? '' : active === row ? ' lit' : ' dim';
    return `trow${extra}${state}`;
  };

  const rowHandlers = (row: number) => ({
    onMouseEnter: () => setActive(row),
    onMouseLeave: () => setActive(null),
  });

  return (
    <div className="auto-2">
      <div className="card vs-card vs-bad stack" style={{ padding: 28, gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>Pedindo para a IA explicar</span>
          <span className="hand" style={{ fontSize: 28, color: 'var(--red-text)', transform: 'rotate(-3deg)' }}>hã?</span>
        </div>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.85, color: 'var(--ink-2)' }}>
          Este componente deve disparar uma <Jargon row={0} {...j}>Server Action</Jargon> que faz o parse do{' '}
          <Jargon row={1} {...j}>FormData</Jargon>, valida com um <Jargon row={2} {...j}>schema</Jargon> e usa o{' '}
          <Jargon row={3} {...j}>client</Jargon> do Supabase para um <Jargon row={3} {...j}>insert</Jargon>. Se não está salvando,
          pode ser permissão da tabela, uma variável de ambiente ou algo no <Jargon row={4} {...j}>schema cache</Jargon>…
        </p>
        <p style={{ margin: 'auto 0 0', fontSize: 14, color: 'var(--muted)' }}>
          Descreve o que o código deveria fazer e chuta o que deu errado. Com seis termos sem explicação.
        </p>
        <span className="hand" style={{ fontSize: 22, color: 'var(--blue-text)' }}>passe o mouse nas palavras sublinhadas →</span>
      </div>

      <div className="card vs-card vs-good stack" style={{ padding: '24px 22px', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 8px 8px' }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>No diagrama</span>
          <span className="hand" style={{ fontSize: 28, color: 'var(--green-text)', transform: 'rotate(-3deg)' }}>ahh, entendi</span>
        </div>
        <div className={rowClass(0)} {...rowHandlers(0)}>
          <span className="chip c-front" style={CHIP_TOP}>1</span>
          <span style={ROW_TEXT}>Ao clicar em “Criar conta”, o formulário chamou uma <span className="tterm">Server Action</span>: uma função do seu código que roda no servidor, e não no navegador.</span>
        </div>
        <div className={rowClass(1)} {...rowHandlers(1)}>
          <span className="chip c-req" style={CHIP_TOP}>2</span>
          <span style={ROW_TEXT}>O que você digitou foi junto, dentro de um <span className="tterm">FormData</span>, o pacote com os campos do formulário. No servidor, o código abriu esse pacote: isso é o “parse”.</span>
        </div>
        <div className={rowClass(2)} {...rowHandlers(2)}>
          <span className="chip c-func" style={CHIP_TOP}>3</span>
          <span style={ROW_TEXT}>Antes de salvar, o código conferiu os dados contra um <span className="tterm">schema</span>, a lista de regras que eles precisam seguir, como o e-mail ter @. Estava tudo certo.</span>
        </div>
        <div className={rowClass(3)} {...rowHandlers(3)}>
          <span className="chip c-func" style={CHIP_TOP}>4</span>
          <span style={ROW_TEXT}>Para salvar, o código usou o <span className="tterm">client</span> do Supabase, a peça que conversa com o banco, e pediu um <span className="tterm">insert</span>: criar uma linha nova na tabela usuarios.</span>
        </div>
        <div className={rowClass(4, ' fail')} {...rowHandlers(4)}>
          <span className="chip c-db" style={CHIP_TOP}>5</span>
          <span style={ROW_TEXT}>O banco recusou com o erro <span className="tterm">42703</span>, que quer dizer “essa coluna não existe”. Na cópia da estrutura das tabelas que o Supabase consulta, o <span className="tterm">schema cache</span>, a tabela usuarios não tinha telefone.</span>
        </div>
      </div>
    </div>
  );
}
