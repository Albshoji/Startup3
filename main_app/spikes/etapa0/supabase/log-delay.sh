#!/bin/bash
# SPIKE — mede quanto tempo um pedido leva para aparecer nos registros (somente leitura).
cd "$(dirname "$0")/../../.." && set -a && . ./.env && set +a
REF=$(echo "$SUPABASE_URL" | sed -E 's#https://([a-z0-9]+)\.supabase\.co.*#\1#')
INTERVAL=${INTERVAL:-15}
sleep "${WAIT_FIRST:-60}"   # deixa o limite de requisições da API de registros zerar
RID=$(curl -s -D - -o /dev/null -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/auth/v1/health" | grep -i "^sb-request-id" | awk '{print $2}' | tr -d '\r')
T0=$(date +%s); throttled=0; queries=0
for i in $(seq 1 40); do
  sleep "$INTERVAL"
  START=$(date -u -d '-10 minutes' +%Y-%m-%dT%H:%M:%SZ); END=$(date -u -d '+1 minutes' +%Y-%m-%dT%H:%M:%SZ)
  queries=$((queries+1))
  N=$(curl -s -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      --data-urlencode "iso_timestamp_start=$START" --data-urlencode "iso_timestamp_end=$END" \
      --data-urlencode "sql=select source, timestamp from logs where log_attributes['request_id'] = '$RID'" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d["result"]) if "result" in d else "ERR")')
  if [ "$N" = "ERR" ]; then throttled=$((throttled+1)); continue; fi
  if [ "$N" != "0" ]; then echo "apareceu após $(( $(date +%s) - T0 ))s ($N registro(s)); consultas=$queries recusadas=$throttled intervalo=${INTERVAL}s"; exit 0; fi
done
echo "não apareceu em $(( $(date +%s) - T0 ))s; consultas=$queries recusadas=$throttled"
