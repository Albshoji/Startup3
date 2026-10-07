-- "Conectar Supabase" (CLAUDE.md §7.4–7.5, Etapa 6): OAuth tokens of the person's Supabase account,
-- per Mapa project. Tokens are stored ENCRYPTED (AES-256-GCM, key only in the site's server) and the
-- token columns can never be read through the API, not even by their owner.

-- Ref of the Supabase project the app uses, detected by the CLI (NEXT_PUBLIC_SUPABASE_URL), to suggest it.
alter table public.projects add column supabase_ref_hint text check (supabase_ref_hint is null or supabase_ref_hint ~ '^[a-z0-9]{6,40}$');

-- Recording has a snapshot of the database structure (supabase-schema.json next to the raw file).
alter table public.recordings add column has_supabase_schema boolean not null default false;

-- OAuth "state" + PKCE verifier between the redirect to Supabase and the return. Server only.
create table public.supabase_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.supabase_connections (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  -- the person's Supabase project chosen for this Mapa project
  supabase_ref text check (supabase_ref is null or supabase_ref ~ '^[a-z0-9]{6,40}$'),
  supabase_project_name text,
  supabase_org_id text,
  -- latest structure read (each recording also keeps its own copy in the bucket)
  schema_snapshot jsonb,
  schema_read_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supabase_oauth_states enable row level security;
alter table public.supabase_connections enable row level security;

create policy "own supabase connection: read" on public.supabase_connections
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.supabase_oauth_states, public.supabase_connections from anon, authenticated;
-- No token column in this list.
grant select (project_id, owner_id, supabase_ref, supabase_project_name, supabase_org_id, schema_snapshot, schema_read_at, connected_at)
  on public.supabase_connections to authenticated;
