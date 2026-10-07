'use client';

import { useState, type FormEvent } from 'react';

type Source = 'hero' | 'final';
type Status = 'idle' | 'invalid' | 'sending' | 'error' | 'done';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  invalid: 'Esse e-mail não parece certo. Confere?',
  error: 'Algo deu errado. Tente de novo?',
};

function Check() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path className="doodle" d="M5 14 L11 19 L21 7" />
    </svg>
  );
}

export default function WaitlistForm({ source }: { source: Source }) {
  const [status, setStatus] = useState<Status>('idle');
  const isFinal = source === 'final';
  const emailId = `email-${source}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();

    if (!EMAIL_RE.test(email)) {
      setStatus('invalid');
      (form.elements.namedItem('email') as HTMLInputElement | null)?.focus();
      return;
    }

    setStatus('sending');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          stack: String(data.get('stack') ?? '').trim() || undefined,
          source,
          website: String(data.get('website') ?? ''),
        }),
      });
      setStatus(res.ok ? 'done' : res.status === 400 ? 'invalid' : 'error');
    } catch {
      setStatus('error');
    }
  }

  const message = status === 'invalid' ? MESSAGES.invalid : status === 'error' ? MESSAGES.error : '';

  return (
    <form
      className="waitlist stack"
      style={isFinal ? { width: '100%', maxWidth: 620, gap: 12, textAlign: 'left' } : { gap: 12, maxWidth: 540 }}
      onSubmit={onSubmit}
      noValidate
    >
      <div
        className="success"
        role="status"
        style={isFinal ? { justifyContent: 'center', fontSize: 17 } : undefined}
        hidden={status !== 'done'}
      >
        {status === 'done' && (
          <>
            <Check />
            Pronto, você está na lista. Avisamos assim que o acesso abrir.
          </>
        )}
      </div>
      {status !== 'done' && (
        <div className="fields stack" style={{ gap: 12 }}>
          {/* Honeypot: pessoas não veem este campo; bots costumam preenchê-lo. */}
          <div className="hp" aria-hidden="true">
            <label htmlFor={`website-${source}`}>Não preencha este campo</label>
            <input id={`website-${source}`} name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div className="form-row">
            <label htmlFor={emailId} className="sr">Seu e-mail</label>
            <input
              id={emailId}
              name="email"
              className="input"
              type="email"
              placeholder="seu@email.com"
              autoComplete="email"
              maxLength={254}
              required
              onInput={() => status === 'invalid' && setStatus('idle')}
            />
            {isFinal ? (
              <>
                <label htmlFor="stack-final" className="sr">Qual stack você usa? (opcional)</label>
                <input
                  id="stack-final"
                  name="stack"
                  className="input"
                  type="text"
                  placeholder="Qual stack você usa? (opcional)"
                  maxLength={120}
                />
              </>
            ) : (
              <button className="btn btn-blue" type="submit" disabled={status === 'sending'}>Entrar na lista</button>
            )}
          </div>
          {isFinal && (
            <button
              className="btn btn-yellow"
              type="submit"
              style={{ width: '100%', fontSize: 17 }}
              disabled={status === 'sending'}
            >
              Entrar na lista
            </button>
          )}
          <p className="form-error" role="alert" style={isFinal ? { textAlign: 'center' } : undefined} hidden={!message}>
            {message}
          </p>
          {isFinal && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>
              Sem spam. Você sai da lista quando quiser.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
