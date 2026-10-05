-- Projeto de TESTE do Mapa (CLAUDE.md §11). Não usar em produção.

-- ---------- profiles + gatilho handle_new_user ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  nome text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "perfil: dono le" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "perfil: dono altera" on public.profiles
  for update to authenticated using (id = (select auth.uid()));

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- items com RLS (owner_id = auth.uid()) e cascata ----------
create table public.items (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.items enable row level security;

create policy "itens: dono le" on public.items
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "itens: dono cria" on public.items
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "itens: dono altera" on public.items
  for update to authenticated using (owner_id = (select auth.uid()));
create policy "itens: dono apaga" on public.items
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------- função do banco (RPC) ----------
-- security invoker (padrão): respeita a RLS, então soma só os itens do usuário.
create function public.calcular_total()
returns numeric
language sql
stable
as $$
  select coalesce(sum(preco), 0) from public.items;
$$;

-- ---------- acessos da API (projetos novos podem não expor o schema public) ----------
grant usage on schema public to anon, authenticated;
-- anon pode consultar, mas a RLS não devolve nada (cenário C: lista vazia por regra de acesso)
grant select on public.items to anon;
grant select, insert, update, delete on public.items to authenticated;
grant select, update on public.profiles to authenticated;
grant execute on function public.calcular_total() to anon, authenticated;

-- ---------- Realtime em items ----------
alter publication supabase_realtime add table public.items;

-- ---------- Storage: bucket avatars com política por usuário ----------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);

create policy "avatars: dono envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: dono le" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: dono altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: dono apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
