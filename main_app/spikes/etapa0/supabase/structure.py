#!/usr/bin/env python3
"""SPIKE — lê a estrutura do banco SOMENTE pelo endpoint read-only da Management API."""
import json, os, sys, urllib.request, pathlib

root = pathlib.Path(__file__).resolve().parents[3]
env = dict(l.split("=", 1) for l in (root / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
url, token = env["SUPABASE_URL"].strip(), env["SUPABASE_ACCESS_TOKEN"].strip()
ref = url.split("//")[1].split(".")[0]
ENDPOINT = f"https://api.supabase.com/v1/projects/{ref}/database/query/read-only"

QUERIES = {
  "tabelas_colunas": """
    select c.table_schema as schema, c.table_name as tabela,
           json_agg(json_build_object('coluna', c.column_name, 'tipo', c.data_type, 'nulo', c.is_nullable, 'padrao', c.column_default) order by c.ordinal_position) as colunas
    from information_schema.columns c
    where c.table_schema = 'public'
    group by 1, 2 order by 1, 2""",
  "rls_ativa": """
    select n.nspname as schema, c.relname as tabela, c.relrowsecurity as rls_ligada, c.relforcerowsecurity as rls_forcada
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public', 'storage') order by 1, 2""",
  "politicas": """
    select schemaname as schema, tablename as tabela, policyname as nome, cmd as operacao, roles as papeis,
           permissive as permissiva, qual as usando, with_check as verificando
    from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3""",
  "chaves_estrangeiras": """
    select con.conname as nome, cl.relname as tabela, ns.nspname as schema,
           fcl.relname as referencia, fns.nspname as schema_referencia,
           case con.confdeltype when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' when 'r' then 'restrict' else 'no action' end as ao_apagar,
           pg_get_constraintdef(con.oid) as definicao
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_class fcl on fcl.oid = con.confrelid join pg_namespace fns on fns.oid = fcl.relnamespace
    where con.contype = 'f' and ns.nspname = 'public' order by 2, 1""",
  "gatilhos": """
    select t.tgname as nome, n.nspname as schema, c.relname as tabela,
           pn.nspname || '.' || p.proname as funcao, pg_get_triggerdef(t.oid) as definicao,
           p.prosrc as codigo_funcao
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and (n.nspname = 'public' or (n.nspname = 'auth' and pn.nspname = 'public'))
    order by 2, 3, 1""",
  "funcoes_rpc": """
    select n.nspname as schema, p.proname as nome, pg_get_function_arguments(p.oid) as argumentos,
           pg_get_function_result(p.oid) as retorno, l.lanname as linguagem,
           case when p.prosecdef then 'definer' else 'invoker' end as seguranca, p.prosrc as codigo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' order by 2""",
  "realtime": """
    select schemaname as schema, tablename as tabela from pg_publication_tables
    where pubname = 'supabase_realtime' order by 1, 2""",
  "webhooks": """
    select t.tgname as nome, c.relname as tabela, pg_get_triggerdef(t.oid) as definicao
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and pn.nspname = 'supabase_functions' and p.proname = 'http_request'""",
  "buckets": """select id, name as nome, public as publico, file_size_limit as limite_bytes, allowed_mime_types as tipos from storage.buckets order by 1""",
  "permissoes_api": """
    select c.relname as tabela, a.grantee::regrole::text as papel,
           string_agg(a.privilege_type, ', ' order by a.privilege_type) as permissoes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relkind = 'r'
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
    group by 1, 2 order by 1, 2""",
}

def run(sql):
    req = urllib.request.Request(ENDPOINT, data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"erro": e.code, "corpo": e.read().decode()[:300]}

snapshot = {name: run(sql) for name, sql in QUERIES.items()}
out = pathlib.Path(__file__).with_name(sys.argv[1] if len(sys.argv) > 1 else "structure-snapshot.json")
out.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
for name, rows in snapshot.items():
    print(f"{name}: {'ERRO ' + str(rows) if isinstance(rows, dict) else str(len(rows)) + ' linha(s)'}")
print(f"-> {out}  ({out.stat().st_size} bytes)")
