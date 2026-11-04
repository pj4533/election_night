#!/bin/bash
# Live-ops watcher: prints only lines worth acting on.
cd "$(dirname "$0")/.." || exit 1
tail -n0 -F logs/events.log logs/error.log logs/client.log 2>/dev/null | grep --line-buffered -E '"raceKey":"(pineplains|stanford-supv|stanford-council|mi-sen|tx-sen|ia-gov)"|"type":"(dutchess-publish|boe)"|"priority":[34],"type":"(call|lead)"|"src":"process"|"kind":"(import|window.error|unhandledrejection|director|update|onEvent|scene|overlay|chyron|alerts|battle|senate|insights)"|"status":(0|5[0-9][0-9])' | grep --line-buffered -v -E '"type":"news"|"type":"votes","raceKey":"(mi-sen|tx-sen|ia-gov)"' &
# health: server alive + Dutchess meta freshness + NYT freshness
while true; do
  h=$(curl -s -m 5 localhost:4173/api/health) || h=""
  if [ -z "$h" ]; then echo "HEALTH: server DOWN"; else
    echo "$h" | python3 -I -c "
import json,sys,time
d=json.load(sys.stdin); now=time.time()*1000; s=d['sources']
for k,lim in (('dutchess',60e3),('nyt',60e3),('kalshi',90e3),('news',180e3)):
  lp=s.get(k,{}).get('lastPoll',0)
  if now-lp>lim or not s.get(k,{}).get('ok',False): print(f'HEALTH: {k} stale/failing lastPoll {int((now-lp)/1000)}s ago ok={s.get(k,{}).get(\"ok\")}')
" 2>&1
  fi
  sleep 30
done
