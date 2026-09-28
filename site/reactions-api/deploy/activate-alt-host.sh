#!/bin/sh
set -eu

test "$(id -un)" = sheepfold-admin
test "$(systemctl is-active caddy.service)" = active
test "$(systemctl is-active sheepfold-message-relay.service)" = active
test "$(systemctl is-active glossaliae-reactions.service)" = active
test "$(sudo sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = f395c78006f9401f6a442881b19f94b6a5932258d26233b9c50cb3ed6e462a4c
test -f /tmp/Caddyfile.glossaliae-alt-candidate
sudo caddy validate --config /tmp/Caddyfile.glossaliae-alt-candidate

backup="/etc/caddy/Caddyfile.before-glossaliae-alt-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -o root -g root -m 0600 /etc/caddy/Caddyfile "$backup"
sudo install -o root -g caddy -m 0640 /tmp/Caddyfile.glossaliae-alt-candidate /etc/caddy/Caddyfile

restore() {
  sudo install -o root -g caddy -m 0640 "$backup" /etc/caddy/Caddyfile
  sudo systemctl restart caddy.service
}

if ! sudo systemctl restart caddy.service; then
  restore
  exit 1
fi

if ! curl -fsS --max-time 5 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null; then
  restore
  exit 1
fi

if ! curl -fsS --max-time 5 -H 'Origin: https://glossalia-explorer.tuqo.ru' http://127.0.0.1:8791/glossaliae/reactions >/dev/null; then
  restore
  exit 1
fi

test "$(systemctl is-active caddy.service)" = active
printf 'Caddy backup: %s\n' "$backup"
