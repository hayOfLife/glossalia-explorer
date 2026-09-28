#!/bin/sh
set -eu

test "$(id -un)" = sheepfold-admin
test "$(systemctl is-active glossaliae-reactions.service)" = active
test "$(systemctl is-active caddy.service)" = active
test -f /tmp/Caddyfile.glossaliae-candidate
sudo caddy validate --config /tmp/Caddyfile.glossaliae-candidate
curl -fsS --max-time 3 -H 'Origin: https://glossalia-explorer.tuqo.ru' http://127.0.0.1:8791/glossaliae/reactions >/dev/null

backup="/etc/caddy/Caddyfile.before-glossaliae-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -o root -g root -m 0600 /etc/caddy/Caddyfile "$backup"
sudo install -o root -g caddy -m 0640 /tmp/Caddyfile.glossaliae-candidate /etc/caddy/Caddyfile
if ! sudo systemctl restart caddy.service; then
  sudo install -o root -g caddy -m 0640 "$backup" /etc/caddy/Caddyfile
  sudo systemctl restart caddy.service
  exit 1
fi
test "$(systemctl is-active caddy.service)" = active
printf 'Caddy backup: %s\n' "$backup"
