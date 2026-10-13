#!/usr/bin/env bash
# Cloudflare WARP sur le VPS : avec le tunnel actif, les reponses aux
# connexions entrantes (SSH) repartent par WARP et la session ne s ouvre
# jamais. Ce script sort du tunnel les IP de WARP_EXCLUDED_IPS (.env), donc
# celles des gens qui doivent joindre la machine. Sans WARP installe, il ne
# fait rien. Lance par donut update et donut setup, ou a la main :
#
#   donut warp
#
# Relancable : une IP deja exclue est sautee, rien n est retire.
set -euo pipefail
cd "$(dirname "$0")/.."

info() { printf '   %s\n' "$1"; }

if ! command -v warp-cli >/dev/null 2>&1; then
  info "warp-cli absent, rien a faire"
  exit 0
fi

brut="$(grep -E '^WARP_EXCLUDED_IPS=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"'" | tr ',' ' ')"
read -ra ips <<<"$brut"
if [ "${#ips[@]}" -eq 0 ]; then
  info "WARP_EXCLUDED_IPS vide dans .env : rien a exclure (ton IP publique y va, sinon SSH casse)"
  exit 0
fi

WARP="warp-cli --accept-tos"
# Depuis warp-cli 2023.7 les routes exclues se gerent par `tunnel ip`,
# avant par add-excluded-route. On detecte la syntaxe presente.
if $WARP tunnel --help >/dev/null 2>&1; then
  lister()  { $WARP tunnel ip list; }
  ajouter() { $WARP tunnel ip add "$1"; }
else
  lister()  { $WARP get-excluded-routes; }
  ajouter() { $WARP add-excluded-route "$1"; }
fi

if ! deja="$(lister 2>&1)"; then
  info "warp-cli ne repond pas, le service tourne-t-il ? (systemctl status warp-svc)"
  printf '   %s\n' "$deja"
  exit 0
fi

# En mode Include, `tunnel ip add` fait l inverse de ce qu on veut.
if $WARP settings 2>/dev/null | grep -iq 'split tunnel.*include'; then
  info "WARP est en mode split tunnel Include : les IP ci-dessous seraient incluses, pas exclues."
  info "Passe le mode en Exclude (dashboard Zero Trust) puis relance donut warp."
  exit 0
fi

for ip in "${ips[@]}"; do
  if ! printf '%s' "$ip" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$'; then
    info "ignore $ip : pas une IPv4 (ex. 2.15.4.58 ou 10.0.0.0/8)"
    continue
  fi
  base="${ip%%/*}"
  if printf '%s\n' "$deja" | grep -qE "(^|[^0-9.])${base//./\\.}([^0-9]|$)"; then
    info "$ip deja hors du tunnel"
  else
    ajouter "$ip" >/dev/null
    info "$ip sortie du tunnel WARP"
  fi
done
