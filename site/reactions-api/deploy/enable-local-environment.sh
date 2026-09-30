#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if test "$#" -ne 3 && test "$#" -ne 4; then
  fail 'Usage: enable-local-environment.sh staging-directory server-sha256 caddy-sha256 [resume-local-state]'
fi
staging=$1
expected_server_sha=$2
expected_caddy_sha=$3
resume_local_state=0
if test "$#" -eq 4; then
  test "$4" = resume-local-state || fail 'Unexpected resume option'
  resume_local_state=1
fi
case "$staging" in
  /tmp/glossaliae-environments-*) ;;
  *) fail 'Unexpected staging directory' ;;
esac
case "${staging#/tmp/glossaliae-environments-}" in
  ''|*[!A-Za-z0-9_-]*) fail 'Unexpected staging directory' ;;
esac
test -d "$staging"
test ! -L "$staging"
test "$(realpath -e -- "$staging")" = "$staging"
for expected_sha in "$expected_server_sha" "$expected_caddy_sha"; do
  test "${#expected_sha}" -eq 64 || fail 'Invalid expected SHA256'
  case "$expected_sha" in
    *[!0-9a-f]*) fail 'Invalid expected SHA256' ;;
  esac
done

test "$(id -un)" = sheepfold-admin
sudo -n true
for service in caddy.service sheepfold-message-relay.service glossaliae-reactions.service; do
  systemctl is-active --quiet "$service"
done
for file in server.mjs transcriptions.json server.test.mjs glossaliae-reactions-local.service Caddy-local-route.caddy; do
  test -f "$staging/$file"
  test ! -L "$staging/$file"
done
sudo -n test ! -e /etc/systemd/system/glossaliae-reactions-local.service
sudo -n test ! -L /etc/systemd/system/glossaliae-reactions-local.service
if test "$resume_local_state" -eq 0; then
  sudo -n test ! -e /var/lib/glossaliae-reactions-local
  sudo -n test ! -L /var/lib/glossaliae-reactions-local
  sudo -n test ! -e /var/lib/private/glossaliae-reactions-local
  sudo -n test ! -L /var/lib/private/glossaliae-reactions-local
else
  sudo -n test -L /var/lib/glossaliae-reactions-local
  case "$(sudo -n readlink /var/lib/glossaliae-reactions-local)" in
    private/glossaliae-reactions-local|/var/lib/private/glossaliae-reactions-local) ;;
    *) fail 'Unexpected retained local state symlink' ;;
  esac
  sudo -n test -d /var/lib/private/glossaliae-reactions-local
  sudo -n test ! -L /var/lib/private/glossaliae-reactions-local
  test "$(sudo -n realpath -e /var/lib/private/glossaliae-reactions-local)" = /var/lib/private/glossaliae-reactions-local
  test "$(sudo -n realpath -e /var/lib/glossaliae-reactions-local)" = /var/lib/private/glossaliae-reactions-local
fi
test "$(systemctl show -p LoadState --value glossaliae-reactions-local.service)" = not-found
sudo -n test -f /opt/glossaliae-reactions/server.mjs
sudo -n test ! -L /opt/glossaliae-reactions/server.mjs
sudo -n test ! -L /opt/glossaliae-reactions/transcriptions.json
sudo -n test -f /etc/caddy/Caddyfile
sudo -n test ! -L /etc/caddy/Caddyfile
test "$(sudo -n sha256sum /opt/glossaliae-reactions/server.mjs | cut -d ' ' -f 1)" = "$expected_server_sha"
test "$(sudo -n sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = "$expected_caddy_sha"

/usr/bin/node --check "$staging/server.mjs"
/usr/bin/node --test "$staging/server.test.mjs"
sudo -n systemd-analyze verify "$staging/glossaliae-reactions-local.service"
curl -fsS --max-time 5 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null

sudo -n /usr/bin/node --input-type=module - "$staging/server.mjs" "$resume_local_state" <<'NODE'
import { pathToFileURL } from 'node:url';

const { createReactionServer } = await import(pathToFileURL(process.argv[2]).href);
createReactionServer({
  storagePath: '/var/lib/glossaliae-reactions/reactions.json',
  allowedOrigin: 'https://glossalia-explorer.tuqo.ru',
});
process.stdout.write('Existing production storage validated without writing\n');
if (process.argv[3] === '1') {
  createReactionServer({
    storagePath: '/var/lib/glossaliae-reactions-local/reactions.json',
    environment: 'local',
  });
  process.stdout.write('Retained local storage validated without writing\n');
}
NODE

backup=$(sudo -n mktemp -d "/var/backups/glossaliae-reactions-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
sudo -n chmod 0700 "$backup"
sudo -n install -o root -g root -m 0600 /opt/glossaliae-reactions/server.mjs "$backup/server.mjs"
sudo -n install -o root -g root -m 0600 /etc/caddy/Caddyfile "$backup/Caddyfile"
had_manifest=0
if sudo -n test -e /opt/glossaliae-reactions/transcriptions.json; then
  sudo -n install -o root -g root -m 0600 /opt/glossaliae-reactions/transcriptions.json "$backup/transcriptions.json"
  had_manifest=1
fi
sudo -n install -o root -g root -m 0600 "$staging/glossaliae-reactions-local.service" "$backup/local.service.new"

sudo -n python3 - "$staging/Caddy-local-route.caddy" "$backup/Caddyfile.candidate" <<'PY'
import re
import sys
from pathlib import Path

source = Path('/etc/caddy/Caddyfile').read_bytes().decode('utf-8')
snippet = Path(sys.argv[1]).read_bytes().decode('utf-8').rstrip() + '\n'
headers = list(re.finditer(r'(?m)^94-232-41-163\.sslip\.io[ \t]+\{[ \t]*$', source))
if len(headers) != 1 or '@glossaliae_reactions_local' in source:
    raise SystemExit('Unexpected Caddy host block or existing local route')

start = headers[0].start()
depth = 0
end = None
offset = start
for line in source[start:].splitlines(keepends=True):
    depth += line.count('{') - line.count('}')
    offset += len(line)
    if depth == 0:
        end = offset
        break
if end is None:
    raise SystemExit('Caddy host block has no closing brace')

block = source[start:end]
markers = list(re.finditer(r'(?m)^[ \t]*@glossaliae_reactions[ \t]+path[ \t]+/glossaliae/reactions[ \t]*$', block))
if len(markers) != 1:
    raise SystemExit('Production matcher is not unique inside the selected host')
position = start + markers[0].start()
candidate = source[:position] + snippet + '\n' + source[position:]
if candidate[:start] != source[:start] or candidate[end + len(snippet) + 1:] != source[end:]:
    raise SystemExit('Unexpected changes outside the selected host')
Path(sys.argv[2]).write_bytes(candidate.encode('utf-8'))
PY
sudo -n caddy validate --config "$backup/Caddyfile.candidate" --adapter caddyfile

server_changed=0
manifest_changed=0
unit_changed=0
caddy_changed=0
completed=0

rollback() {
  status=$1
  trap - EXIT HUP INT TERM
  test "$completed" -eq 0 || exit "$status"
  set +e
  rollback_ok=1
  if test "$caddy_changed" -eq 1 && ! sudo -n cmp -s /etc/caddy/Caddyfile "$backup/Caddyfile"; then
    sudo -n install -o root -g caddy -m 0640 "$backup/Caddyfile" /etc/caddy/Caddyfile || rollback_ok=0
    sudo -n systemctl restart caddy.service || rollback_ok=0
  fi
  if test "$unit_changed" -eq 1; then
    sudo -n systemctl disable --now glossaliae-reactions-local.service || rollback_ok=0
    if sudo -n test -e /etc/systemd/system/glossaliae-reactions-local.service; then
      sudo -n mv /etc/systemd/system/glossaliae-reactions-local.service "$backup/local.service.rolled-back" || rollback_ok=0
    fi
    sudo -n systemctl daemon-reload || rollback_ok=0
  fi
  if test "$server_changed" -eq 1 && ! sudo -n cmp -s /opt/glossaliae-reactions/server.mjs "$backup/server.mjs"; then
    sudo -n install -o root -g root -m 0644 "$backup/server.mjs" /opt/glossaliae-reactions/server.mjs || rollback_ok=0
  fi
  if test "$manifest_changed" -eq 1; then
    if test "$had_manifest" -eq 1; then
      if ! sudo -n cmp -s /opt/glossaliae-reactions/transcriptions.json "$backup/transcriptions.json"; then
        sudo -n install -o root -g root -m 0644 "$backup/transcriptions.json" /opt/glossaliae-reactions/transcriptions.json || rollback_ok=0
      fi
    elif sudo -n test -e /opt/glossaliae-reactions/transcriptions.json; then
      sudo -n mv /opt/glossaliae-reactions/transcriptions.json "$backup/transcriptions.json.rolled-back" || rollback_ok=0
    fi
  fi
  if test "$server_changed" -eq 1 || test "$manifest_changed" -eq 1; then
    sudo -n systemctl restart glossaliae-reactions.service || rollback_ok=0
    curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8791/glossaliae/reactions >/dev/null || rollback_ok=0
  fi
  curl -fsS --max-time 5 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null || rollback_ok=0
  for service in caddy.service sheepfold-message-relay.service glossaliae-reactions.service; do
    systemctl is-active --quiet "$service" || rollback_ok=0
  done
  printf 'Deployment failed; rollback checks passed=%s; private backup=%s\n' "$rollback_ok" "$backup" >&2
  test "$status" -ne 0 || status=1
  exit "$status"
}
trap 'rollback $?' EXIT
trap 'exit 1' HUP INT TERM

# Повторная сверка защищает от изменения конфигурации во время предварительных проверок
test "$(sudo -n sha256sum /opt/glossaliae-reactions/server.mjs | cut -d ' ' -f 1)" = "$expected_server_sha"
test "$(sudo -n sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = "$expected_caddy_sha"
server_changed=1
sudo -n install -o root -g root -m 0644 "$staging/server.mjs" /opt/glossaliae-reactions/server.mjs
manifest_changed=1
sudo -n install -o root -g root -m 0644 "$staging/transcriptions.json" /opt/glossaliae-reactions/transcriptions.json
unit_changed=1
sudo -n install -o root -g root -m 0644 "$staging/glossaliae-reactions-local.service" /etc/systemd/system/glossaliae-reactions-local.service
sudo -n systemctl daemon-reload
sudo -n systemctl restart glossaliae-reactions.service
sudo -n systemctl enable --now glossaliae-reactions-local.service
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 -H 'Origin: https://glossalia-explorer.tuqo.ru' http://127.0.0.1:8791/glossaliae/reactions >/dev/null
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 -H 'Origin: http://localhost:8877' http://127.0.0.1:8792/glossaliae/reactions-local >/dev/null

caddy_changed=1
sudo -n install -o root -g caddy -m 0640 "$backup/Caddyfile.candidate" /etc/caddy/Caddyfile
# У Caddy отключён административный API, поэтому применение требует перезапуска службы
sudo -n systemctl restart caddy.service
curl -fsS --max-time 5 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null
for service in caddy.service sheepfold-message-relay.service glossaliae-reactions.service glossaliae-reactions-local.service; do
  systemctl is-active --quiet "$service"
done
completed=1
printf 'Production and local reactions enabled; private backup=%s\n' "$backup"
