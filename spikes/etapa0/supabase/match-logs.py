#!/usr/bin/env python3
"""SPIKE — liga pedidos gravados (arquivos real-*.appmap.json) aos registros do Supabase (somente leitura)."""
import json, glob, time, urllib.request, urllib.parse, pathlib, datetime as dt

root = pathlib.Path(__file__).resolve().parents[3]
env = dict(l.split("=", 1) for l in (root / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
ref = env["SUPABASE_URL"].strip().split("//")[1].split(".")[0]
token = env["SUPABASE_ACCESS_TOKEN"].strip()
iso = lambda t: dt.datetime.fromtimestamp(t, dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

def logs(sql, t0, t1):
    q = urllib.parse.urlencode({"iso_timestamp_start": iso(t0), "iso_timestamp_end": iso(t1), "sql": sql})
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs?{q}", headers={"Authorization": f"Bearer {token}"})
    for _ in range(4):
        try:
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read()).get("result", [])
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(20); continue
            raise
    return []

recorded = []
for f in sorted(glob.glob(str(root / "spikes/etapa0/out/real-*.appmap.json"))):
    a = json.load(open(f))
    rets = {e["parent_id"]: e for e in a["events"] if e["event"] == "return"}
    for e in a["events"]:
        req = e.get("http_client_request")
        if e["event"] == "call" and req and "supabase.co" in req["url"] and "/realtime/" not in req["url"]:
            st = (rets.get(e["id"], {}).get("http_client_response") or {}).get("status_code")
            sbid = ((rets.get(e["id"], {}).get("http_client_response") or {}).get("headers") or {}).get("sb-request-id")
            recorded.append({"file": pathlib.Path(f).stem, "layer": e["layer"], "t": e["timestamp"], "method": req["request_method"],
                             "path": urllib.parse.urlparse(req["url"]).path, "status": st, "sbid": sbid})

t0 = min(r["t"] for r in recorded) - 120
t1 = max(r["t"] for r in recorded) + 120
rows = logs("select timestamp, source, event_message, log_attributes['request.method'] as method, coalesce(nullIf(log_attributes['request.path'], ''), path(log_attributes['request.url'])) as path, log_attributes['request.url'] as url, "
            "log_attributes['response.status_code'] as status, log_attributes['request_id'] as request_id from logs "
            "where source in ('edge_logs', 'function_edge_logs') order by timestamp", t0, t1)
for r in rows:
    r["ts"] = dt.datetime.fromisoformat(r["timestamp"]).replace(tzinfo=dt.UTC).timestamp()

print(f"{len(recorded)} pedidos gravados, {len(rows)} registros de API na janela\n")
used = set()
for rec in recorded:
    cands = [r for r in rows if r.get("method") == rec["method"] and r.get("path") == rec["path"]
             and str(r.get("status")) == str(rec["status"]) and abs(r["ts"] - rec["t"]) < 5 and r["request_id"] not in used]
    cands.sort(key=lambda r: abs(r["ts"] - rec["t"]))
    if rec["sbid"]:
        exact = [r for r in rows if r["request_id"] == rec["sbid"]]
        how = f"exato por sb-request-id ({len(exact)})"
        if exact: used.add(exact[0]["request_id"])
    elif cands:
        used.add(cands[0]["request_id"])
        how = f"por horário+método+caminho+status: {len(cands)} candidato(s), Δ={cands[0]['ts']-rec['t']:+.2f}s"
    else:
        how = "SEM registro correspondente"
    print(f"{rec['file'][5:]:<20} [{rec['layer']:<11}] {rec['method']} {rec['path']} {rec['status']} -> {how}")

db = logs("select timestamp, event_message, log_attributes['parsed.error_severity'] as severidade, log_attributes['parsed.user_name'] as papel "
          "from logs where source = 'postgres_logs' and event_message like '%row-level security%' order by timestamp", t0, t1)
print(f"\npostgres_logs com 'row-level security' na janela: {len(db)}")
for r in db[:5]: print("  ", r["timestamp"], r.get("severidade"), r.get("papel"), "|", r["event_message"][:120])
auth = logs("select count() as n from logs where source = 'auth_logs'", t0, t1)
print("auth_logs na janela:", auth)
