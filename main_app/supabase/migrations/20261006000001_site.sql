-- Database of the MAPA SITE (not the user's project). CLAUDE.md §5 and Etapa 5.
-- Every table has RLS. Users only READ their own rows; every write goes through the site's API
-- (server code with the service key), which checks the CLI token or the session first.

-- ---------------------------------------------------------------- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- name from the app's package.json; one project per (owner, name)
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

-- ---------------------------------------------------------------- recordings
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text check (name is null or char_length(name) <= 200),
  -- enviando → recebida → processando → pronta (app) → pronta (com registros) / erro (CLAUDE.md §4 and Etapa 7)
  status text not null default 'enviando'
    check (status in ('enviando', 'recebida', 'processando', 'pronta', 'pronta_com_registros', 'erro')),
  started_at timestamptz,
  stopped_at timestamptz,
  stopped_by text,
  event_count integer check (event_count is null or event_count >= 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  gzip_bytes bigint check (gzip_bytes is null or gzip_bytes >= 0),
  -- folder in the private bucket `recordings`: <owner_id>/<recording id>/
  storage_prefix text not null,
  -- non-sensitive summary of the AppMap metadata (app, frameworks, git branch...)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index recordings_owner_created on public.recordings (owner_id, created_at desc);
create index recordings_project on public.recordings (project_id, created_at desc);

-- ---------------------------------------------------------------- CLI login (device code, like `gh auth login`)
create table public.cli_device_codes (
  -- sha256 of the secret device code kept by the CLI
  device_code_hash text primary key,
  -- short code the person types on the site, e.g. ABCD-2345
  user_code text not null unique,
  client_name text,
  user_id uuid references auth.users (id) on delete cascade,
  approved_at timestamptz,
  -- set when the CLI picked up its token (a code works once)
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.cli_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- sha256 of the token; the token itself is only in the person's computer
  token_hash text not null unique,
  name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index cli_tokens_user on public.cli_tokens (user_id);

-- ---------------------------------------------------------------- RLS on every table
alter table public.projects enable row level security;
alter table public.recordings enable row level security;
alter table public.cli_device_codes enable row level security;
alter table public.cli_tokens enable row level security;

create policy "own projects: read" on public.projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "own recordings: read" on public.recordings
  for select to authenticated using (owner_id = (select auth.uid()));
-- the person can see (not create) the computers logged into their account
create policy "own cli tokens: read" on public.cli_tokens
  for select to authenticated using (user_id = (select auth.uid()));
-- cli_device_codes: no policy at all → only the site's server (service key) reaches it

-- Only reads through the API; nothing for anonymous visitors.
revoke all on public.projects, public.recordings, public.cli_device_codes, public.cli_tokens from anon, authenticated;
grant select on public.projects, public.recordings to authenticated;
grant select (id, name, created_at, last_used_at, revoked_at) on public.cli_tokens to authenticated;

-- ---------------------------------------------------------------- private bucket for the raw files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 52428800, array['application/gzip', 'application/json'])
on conflict (id) do nothing;

-- Owners may download their own files (folder = their user id). Uploads only happen through
-- signed upload URLs created by the server; there is no insert/update/delete policy.
create policy "own recording files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
