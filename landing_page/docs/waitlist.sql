-- Waitlist table for the landing page.
-- Run in the Supabase SQL editor (or as a migration).

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  stack       text,
  source      text not null default 'hero' check (source in ('hero', 'final')),
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- One entry per e-mail (case-insensitive).
create unique index if not exists waitlist_email_unique on public.waitlist (lower(email));

-- Lock the table down: nobody can read it from the browser.
alter table public.waitlist enable row level security;

-- Inserts happen only from the server (Next.js route handler) using the
-- service role key, which bypasses RLS. No public policies are created on purpose.
