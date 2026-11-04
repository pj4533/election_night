#!/bin/bash
# Ship a change everywhere: syntax check → restart local live server (by PID, never pkill) → deploy Vercel prod
# (the Vercel step runs only if this folder is linked: `vercel link`).
set -e
cd "$(dirname "$0")/.."
for f in server/*.mjs server/sources/*.mjs api/*.mjs public/js/*.js public/js/scene/*.js; do node --check "$f"; done
# kill the live listener AND any orphaned live-server copies (no PORT= env → the live one); agents' test servers set PORT and are left alone
PIDS="$(lsof -tiTCP:4173 -sTCP:LISTEN || true) $(for p in $(pgrep -f '^node server/index.mjs$' || true); do ps eww -o command= $p | grep -q ' PORT=' || echo $p; done)"
for p in $PIDS; do kill $p 2>/dev/null || true; done; sleep 1
nohup node server/index.mjs > logs/stdout.log 2>&1 &
sleep 3; curl -sf -o /dev/null localhost:4173/api/health && echo "local :4173 OK"
if [ -f .vercel/project.json ]; then vercel deploy --prod --yes 2>&1 | grep -E "Aliased|rror"; else echo "(not linked to Vercel; skipped deploy)"; fi
