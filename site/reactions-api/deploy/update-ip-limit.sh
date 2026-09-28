#!/bin/sh
set -eu

test "$(id -un)" = sheepfold-admin
test "$(systemctl is-active glossaliae-reactions.service)" = active
test "$(systemctl is-active caddy.service)" = active
test "$(systemctl is-active sheepfold-message-relay.service)" = active
test "$(sudo sha256sum /opt/glossaliae-reactions/server.mjs | cut -d ' ' -f 1)" = c4412a17f03f41dfa9f101e09e0c0e6ccb5b7f88e18382e47acb95032772e344
test -f /tmp/server.mjs
test -f /tmp/server.test.mjs

node --check /tmp/server.mjs
node --test /tmp/server.test.mjs

backup="/opt/glossaliae-reactions/server.mjs.before-ip-limit-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -o root -g root -m 0600 /opt/glossaliae-reactions/server.mjs "$backup"
sudo install -o root -g root -m 0644 /tmp/server.mjs /opt/glossaliae-reactions/server.mjs
if ! sudo systemctl restart glossaliae-reactions.service; then
  sudo install -o root -g root -m 0644 "$backup" /opt/glossaliae-reactions/server.mjs
  sudo systemctl restart glossaliae-reactions.service
  exit 1
fi
if ! curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8791/glossaliae/reactions >/dev/null; then
  sudo install -o root -g root -m 0644 "$backup" /opt/glossaliae-reactions/server.mjs
  sudo systemctl restart glossaliae-reactions.service
  exit 1
fi
test "$(systemctl is-active glossaliae-reactions.service)" = active
printf 'API backup: %s\n' "$backup"
