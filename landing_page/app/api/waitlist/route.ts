import { createClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_STACK = 120;
const MAX_USER_AGENT = 500;

// Limite simples por IP, em memória: 5 envios por minuto.
// Em serverless cada instância tem a sua contagem; serve para conter abuso básico.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > RATE_LIMIT;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

const ok = () => Response.json({ ok: true });

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Honeypot preenchido: finge sucesso e não grava nada.
  if (typeof body.website === 'string' && body.website.trim() !== '') return ok();

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }

  const stackRaw = typeof body.stack === 'string' ? body.stack.trim() : '';
  if (stackRaw.length > MAX_STACK) {
    return Response.json({ error: 'invalid_stack' }, { status: 400 });
  }

  const source = body.source === 'final' ? 'final' : 'hero';

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('waitlist: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas');
    return Response.json({ error: 'server_error' }, { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.from('waitlist').insert({
    email,
    stack: stackRaw || null,
    source,
    user_agent: req.headers.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null,
  });

  // 23505 = e-mail já cadastrado. Responde sucesso para não revelar quem está na lista.
  if (error && error.code !== '23505') {
    console.error('waitlist: falha ao inserir', error.code, error.message);
    return Response.json({ error: 'server_error' }, { status: 500 });
  }

  return ok();
}
