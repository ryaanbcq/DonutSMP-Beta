#!/usr/bin/env bash
# Met a jour une installation existante : code, dependances, commandes, process.
#
#   cd /opt/donutsmp-fr-bot && bash scripts/update.sh
#
# Le .env n est jamais touche, seulement complete par les nouvelles cles.
set -euo pipefail
cd "$(dirname "$0")/.."

etape() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

etape "Code"
if [ -n "$(git status --porcelain)" ]; then
  echo "Des modifications locales trainent, je ne pull pas :" >&2
  git status --short >&2
  exit 1
fi
git pull --ff-only

etape "Dependances"
npm ci --no-audit --no-fund

etape "Nouvelles cles du .env"
node scripts/sync-env.js

etape "Acces SSH a travers WARP"
bash scripts/warp.sh

etape "Slash commands"
npm run deploy

etape "Process"
# pm2 restart ne relit pas ecosystem.config.cjs ni le .env : delete puis start.
for app in fr-discord fr-ingame; do
  if pm2 describe "$app" >/dev/null 2>&1; then
    pm2 delete "$app" >/dev/null
    pm2 start ecosystem.config.cjs --only "$app"
  fi
done
pm2 save

etape "Controle"
node scripts/doctor.js
