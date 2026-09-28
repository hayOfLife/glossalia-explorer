#!/bin/sh
set -eu

test "$(id -un)" = sheepfold-admin
test "$(systemctl is-active caddy.service)" = active
test "$(systemctl is-active sheepfold-message-relay.service)" = active
test "$(systemctl is-active glossaliae-reactions.service)" = active
test "$(sudo sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = 56d25f8c9075bc354da6bf17e866c268ee3548b20aa2b623cf4562de56c61a39
test "$(sudo sha256sum /opt/glossaliae-reactions/server.mjs | cut -d ' ' -f 1)" = ca6a46c3e2ab0f221b834cbf1c511c2177de0c82006a5a6b85882a14d062e68f
test -f /tmp/server.mjs
test -f /tmp/server.test.mjs
test -f /tmp/Caddy-route.caddy

node --check /tmp/server.mjs
node --test /tmp/server.test.mjs

sudo python3 - <<'PY'
from pathlib import Path

source = Path('/etc/caddy/Caddyfile').read_text()
new_route = Path('/tmp/Caddy-route.caddy').read_text().rstrip()
old_route = new_route.replace('\t\t\theader_up X-Glossaliae-Client-IP {remote_host}\n', '')
assert old_route != new_route
assert source.count(old_route) == 1
Path('/tmp/Caddyfile.glossaliae-rate-candidate').write_text(source.replace(old_route, new_route))
PY
sudo caddy validate --config /tmp/Caddyfile.glossaliae-rate-candidate
sudo caddy adapt --config /tmp/Caddyfile.glossaliae-rate-candidate --pretty >/dev/null

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
caddy_backup="/etc/caddy/Caddyfile.before-glossaliae-rate-$stamp"
server_backup="/opt/glossaliae-reactions/server.mjs.before-rate-$stamp"
sudo install -o root -g root -m 0600 /etc/caddy/Caddyfile "$caddy_backup"
sudo install -o root -g root -m 0600 /opt/glossaliae-reactions/server.mjs "$server_backup"

sudo install -o root -g caddy -m 0640 /tmp/Caddyfile.glossaliae-rate-candidate /etc/caddy/Caddyfile
if ! sudo systemctl restart caddy.service; then
  sudo install -o root -g caddy -m 0640 "$caddy_backup" /etc/caddy/Caddyfile
  sudo systemctl restart caddy.service
  exit 1
fi
if ! curl -fsS --max-time 3 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null; then
  sudo install -o root -g caddy -m 0640 "$caddy_backup" /etc/caddy/Caddyfile
  sudo systemctl restart caddy.service
  exit 1
fi

sudo install -o root -g root -m 0644 /tmp/server.mjs /opt/glossaliae-reactions/server.mjs
if ! sudo systemctl restart glossaliae-reactions.service; then
  sudo install -o root -g root -m 0644 "$server_backup" /opt/glossaliae-reactions/server.mjs
  sudo systemctl restart glossaliae-reactions.service
  sudo install -o root -g caddy -m 0640 "$caddy_backup" /etc/caddy/Caddyfile
  sudo systemctl restart caddy.service
  exit 1
fi
if ! curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8791/glossaliae/reactions >/dev/null; then
  sudo install -o root -g root -m 0644 "$server_backup" /opt/glossaliae-reactions/server.mjs
  sudo systemctl restart glossaliae-reactions.service
  sudo install -o root -g caddy -m 0640 "$caddy_backup" /etc/caddy/Caddyfile
  sudo systemctl restart caddy.service
  exit 1
fi
test "$(systemctl is-active caddy.service)" = active
test "$(systemctl is-active sheepfold-message-relay.service)" = active
test "$(systemctl is-active glossaliae-reactions.service)" = active
printf 'Caddy backup: %s\nAPI backup: %s\n' "$caddy_backup" "$server_backup"
