#!/usr/bin/env python3
"""SPIKE — espera os registros de uma chamada de Edge Function (somente leitura) e mede o atraso."""
import json, sys, time, urllib.request, urllib.parse, pathlib, datetime as dt

root = pathlib.Path(__file__).resolve().parents[3]
env = dict(l.split("=", 1) for l in (root / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
ref = env["SUPABASE_URL"].strip().split("//")[1].split(".")[0]
token = env["SUPABASE_ACCESS_TOKEN"].strip()
request_id, execution_id, called_at = sys.argv[1], sys.argv[2], float(sys.argv[3])

def logs(sql):
    start = (dt.datetime.utcnow() - dt.timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = (dt.datetime.utcnow() + dt.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    q = urllib.parse.urlencode({"iso_timestamp_start": start, "iso_timestamp_end": end, "sql": sql})
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs?{q}",
                                 headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"{e.code} {e.read().decode()[:200]}"}

found, throttled = {}, 0
for _ in range(40):
    time.sleep(15)
    d = logs("select source, timestamp, event_message, log_attributes from logs "
             f"where log_attributes['request_id'] = '{request_id}' "
             f"or log_attributes['execution_id'] = '{execution_id}' "
             "or event_message like '%send-welcome%' order by timestamp")
    if "error" in d:
        throttled += 1
        continue
    for r in d.get("result", []):
        key = (r["source"], r["event_message"][:60])
        if key not in found:
            found[key] = time.time() - called_at
            attrs = {k: v for k, v in (r.get("log_attributes") or {}).items()
                     if not any(s in k.lower() for s in ("ip", "authorization", "apikey", "cookie", "jwt"))}
            print(f"[+{found[key]:.0f}s] {r['source']}: {r['event_message'][:110]}")
            print(f"        chaves: {sorted(attrs)[:25]}")
            sys.stdout.flush()
    sources = {s for s, _ in found}
    if len([k for k in found if "send-welcome:" in k[1]]) >= 3 and len(sources) >= 2:
        break
print(f"fim: {len(found)} registro(s), fontes={sorted({s for s, _ in found})}, consultas recusadas={throttled}")
