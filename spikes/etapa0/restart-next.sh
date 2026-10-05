#!/bin/bash
# usage: restart-next.sh [--webpack] [--no-mapa]
cd "$(dirname "$0")/app"
fuser -k 3100/tcp >/dev/null 2>&1; pkill -f "[n]ode_modules/.bin/next"; sleep 1
rm -rf .next ../loader.log
FLAGS=""; MAPA=1
for a in "$@"; do [ "$a" = "--webpack" ] && FLAGS="--webpack"; [ "$a" = "--no-mapa" ] && MAPA=0; done
MAPA=$MAPA MAPA_LIB_AWAITS=${MAPA_LIB_AWAITS:-0} MAPA_LOADER_LOG=$PWD/../loader.log nohup npx next dev $FLAGS -p 3100 > ../out-next.log 2>&1 &
for i in $(seq 1 60); do grep -q "Ready" ../out-next.log && break; sleep 1; done
grep -m1 "Next.js" ../out-next.log
