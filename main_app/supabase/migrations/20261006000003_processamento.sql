-- Processing of recordings (Etapa 7): queue of jobs run by the site's server.
--   phase "app":  validation, pruning, crossing with the database structure → status "pronta"
--   phase "logs": Supabase logs as eventUpdates (minutes later, with retries) → "pronta_com_registros"

alter table public.recordings
  add column processing_error text,
  add column processed_at timestamptz,
  add column logs_checked_at timestamptz,
  -- short, non-sensitive summary for the site (counts, findings, what was pruned)
  add column summary jsonb not null default '{}'::jsonb;

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  phase text not null check (phase in ('app', 'logs')),
  status text not null default 'pendente' check (status in ('pendente', 'rodando', 'feito', 'erro')),
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (recording_id, phase)
);
create index processing_jobs_due on public.processing_jobs (status, run_after);

alter table public.processing_jobs enable row level security;
revoke all on public.processing_jobs from anon, authenticated;
-- no policy: only the site's server (service key) uses the queue

-- Takes up to `max_jobs` due jobs at once (several servers never take the same one); a job stuck
-- "rodando" for 10 minutes (server stopped in the middle) is taken again.
create function public.claim_processing_jobs(max_jobs integer)
returns setof public.processing_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.processing_jobs
     set status = 'rodando', locked_at = now(), attempts = attempts + 1
   where id in (
     select id from public.processing_jobs
      where (status = 'pendente' and run_after <= now())
         or (status = 'rodando' and locked_at < now() - interval '10 minutes')
      order by run_after
      limit max_jobs
      for update skip locked)
  returning *;
$$;
revoke execute on function public.claim_processing_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_processing_jobs(integer) to service_role;
