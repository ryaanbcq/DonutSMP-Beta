#!/usr/bin/env bash
# Installe le bot sur un VPS neuf (Debian 12 / Ubuntu 22.04+).
#
#   git clone git@github.com:<toi>/donutsmp-fr-bot.git /opt/donutsmp-fr-bot
#   cd /opt/donutsmp-fr-bot && bash scripts/vps-install.sh
#
# Le script est idempotent : le relancer ne casse rien, il saute ce qui est
# deja fait. Il s arrete a la premiere erreur.
#
#   --sans-ingame   n installe que le bot Discord (pas de compte Minecraft)
#   --auto          ne pose aucune question, s arrete si le .env est incomplet
set -euo pipefail

cd "$(dirname "$0")/.."
RACINE="$(pwd)"
SANS_INGAME=0
AUTO=0
for a in "$@"; do
  case "$a" in
    --sans-ingame) SANS_INGAME=1 ;;
    --auto) AUTO=1 ;;
    *) echo "Option inconnue : $a" >&2; exit 1 ;;
  esac
done

etape() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
info()  { printf '   %s\n' "$1"; }
SUDO=''
[ "$(id -u)" -ne 0 ] && SUDO='sudo'

etape "Paquets de base"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl ca-certificates git >/dev/null
  info "curl, git, ca-certificates"
else
  info "apt-get absent, je saute (installe curl et git toi meme si besoin)"
fi

etape "Node 22+"
# node:sqlite arrive en 22.5 : le bot ne demarre pas en dessous.
besoin_node=1
if command -v node >/dev/null 2>&1; then
  v="$(node -p 'process.versions.node')"
  maj="${v%%.*}"; reste="${v#*.}"; min="${reste%%.*}"
  if [ "$maj" -gt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -ge 5 ]; }; then
    besoin_node=0; info "node $v deja installe"
  else
    info "node $v trop vieux, mise a jour"
  fi
fi
if [ "$besoin_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >/dev/null
  $SUDO apt-get install -y -qq nodejs >/dev/null
  info "node $(node -p 'process.versions.node')"
fi

etape "pm2"
if command -v pm2 >/dev/null 2>&1; then
  info "pm2 deja installe"
else
  $SUDO npm install -g pm2 >/dev/null
  info "pm2 $(pm2 -v)"
fi

etape "Dependances du projet"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

etape "Fichier .env"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  info ".env cree a partir de .env.example"
else
  chmod 600 .env
  node scripts/sync-env.js
fi

# Le token ne se devine pas : il faut le coller une fois. setup.js le lit sur
# stdin, en deduit l id de l application et le serveur, et ecrit le .env.
if ! grep -q '^DISCORD_TOKEN=.\+' .env; then
  if [ "$AUTO" -eq 1 ]; then
    echo "DISCORD_TOKEN vide et --auto demande : remplis .env puis relance." >&2
    exit 1
  fi
  etape "Token Discord"
  info "Portail dev > ton application > Bot > Reset Token"
  node scripts/setup.js
fi

etape "Slash commands"
npm run deploy

if [ "$SANS_INGAME" -eq 0 ]; then
  etape "Compte Minecraft"
  if node scripts/auth.js --check >/dev/null 2>&1; then
    info "cache Microsoft deja valide"
  elif [ "$AUTO" -eq 1 ]; then
    info "pas de cache Microsoft et --auto demande : lance node scripts/auth.js a la main"
  else
    info "Microsoft va afficher un code a saisir dans un navigateur"
    node scripts/auth.js
  fi
fi

etape "Commande donut"
# Un lien dans le PATH, pour piloter le bot depuis n importe quel dossier.
LIEN=/usr/local/bin/donut
if [ -L "$LIEN" ] && [ "$(readlink "$LIEN")" = "$RACINE/bin/donut" ]; then
  info "donut deja en place"
elif $SUDO ln -sf "$RACINE/bin/donut" "$LIEN" 2>/dev/null; then
  info "donut installe ($LIEN)"
else
  info "pas de droits sur $LIEN : utilise $RACINE/bin/donut"
fi

etape "Demarrage pm2"
# Un seul --only par commande : deux dans la meme ligne et seul le dernier part.
pm2 delete fr-discord >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --only fr-discord
if [ "$SANS_INGAME" -eq 0 ]; then
  pm2 delete fr-ingame >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --only fr-ingame
fi
pm2 save
if [ "$(id -u)" -eq 0 ]; then
  pm2 startup systemd -u root --hp /root >/dev/null
  info "demarrage automatique au boot arme"
else
  info "pour le demarrage au boot : sudo env PATH=\$PATH pm2 startup systemd -u $USER --hp $HOME"
fi

etape "Controle final"
node scripts/doctor.js || true

printf '\nInstalle dans %s\n' "$RACINE"
printf 'Logs      : pm2 logs fr-discord\n'
printf 'Mise a jour : bash scripts/update.sh\n\n'
