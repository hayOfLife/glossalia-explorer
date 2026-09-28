#!/bin/sh
set -eu

test "$(id -un)" = sheepfold-admin
test -f /tmp/server.mjs
test -f /tmp/glossaliae-reactions.service
test -f /tmp/Caddy-route.caddy
test ! -e /etc/systemd/system/glossaliae-reactions.service
test ! -e /opt/glossaliae-reactions
test ! -e /var/lib/glossaliae-reactions
test "$(systemctl is-active caddy.service)" = active
test "$(systemctl is-active sheepfold-message-relay.service)" = active
curl -fsS --max-time 3 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null

node --check /tmp/server.mjs
systemd-analyze verify /tmp/glossaliae-reactions.service

sudo python3 - <<'PY'
from pathlib import Path

source = Path('/etc/caddy/Caddyfile').read_text()
marker = '\n\thandle {\n\t\trespond 404\n\t}\n'
assert source.count(marker) == 1
assert 'glossaliae_reactions' not in source
route = Path('/tmp/Caddy-route.caddy').read_text().rstrip()
Path('/tmp/Caddyfile.glossaliae-candidate').write_text(source.replace(marker, '\n' + route + '\n' + marker))
PY
caddy validate --config /tmp/Caddyfile.glossaliae-candidate
caddy adapt --config /tmp/Caddyfile.glossaliae-candidate --pretty >/dev/null

sudo install -d -o root -g root -m 0755 /opt/glossaliae-reactions
sudo install -o root -g root -m 0644 /tmp/server.mjs /opt/glossaliae-reactions/server.mjs
sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin glossaliae-reactions
sudo install -d -o glossaliae-reactions -g glossaliae-reactions -m 0700 /var/lib/glossaliae-reactions
sudo install -o root -g root -m 0644 /tmp/glossaliae-reactions.service /etc/systemd/system/glossaliae-reactions.service
sudo systemctl daemon-reload
sudo systemd-analyze verify glossaliae-reactions.service
sudo systemctl enable --now glossaliae-reactions.service
test "$(systemctl is-active glossaliae-reactions.service)" = active
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 -H 'Origin: https://glossalia-explorer.tuqo.ru' http://127.0.0.1:8791/glossaliae/reactions >/dev/null

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
