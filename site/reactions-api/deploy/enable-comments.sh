#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

test "$#" -eq 4 || fail 'Usage: enable-comments.sh staging-directory server-sha256 caddy-sha256 unit-sha256'
staging=$1
expected_server_sha=$2
expected_caddy_sha=$3
expected_unit_sha=$4
case "$staging" in
  /tmp/glossaliae-comments-*) ;;
  *) fail 'Unexpected staging directory' ;;
esac
case "${staging#/tmp/glossaliae-comments-}" in
  ''|*[!A-Za-z0-9_-]*) fail 'Unexpected staging directory' ;;
esac
test -d "$staging"
test ! -L "$staging"
test "$(realpath -e -- "$staging")" = "$staging"
test "$(stat -c %a "$staging")" = 700
for expected_sha in "$expected_server_sha" "$expected_caddy_sha" "$expected_unit_sha"; do
  test "${#expected_sha}" -eq 64 || fail 'Invalid SHA256'
  case "$expected_sha" in *[!0-9a-f]*) fail 'Invalid SHA256' ;; esac
done

test "$(id -un)" = sheepfold-admin
sudo -n true
for service in caddy.service sheepfold-message-relay.service glossaliae-reactions.service glossaliae-reactions-local.service; do
  systemctl is-active --quiet "$service"
done
for file in server.mjs comments.mjs transcriptions.json server.test.mjs comments.test.mjs glossaliae-reactions.service Caddy-comments-route.caddy comments-admin.env; do
  test -f "$staging/$file"
  test ! -L "$staging/$file"
done
for file in /opt/glossaliae-reactions/server.mjs /opt/glossaliae-reactions/transcriptions.json /etc/caddy/Caddyfile /etc/systemd/system/glossaliae-reactions.service; do
  sudo -n test -f "$file"
  sudo -n test ! -L "$file"
done
for target in /opt/glossaliae-reactions/comments.mjs /etc/glossaliae-reactions /var/lib/glossaliae-reactions/comments.json; do
  sudo -n test ! -e "$target"
  sudo -n test ! -L "$target"
done
test "$(sudo -n sha256sum /opt/glossaliae-reactions/server.mjs | cut -d ' ' -f 1)" = "$expected_server_sha"
test "$(sudo -n sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = "$expected_caddy_sha"
test "$(sudo -n sha256sum /etc/systemd/system/glossaliae-reactions.service | cut -d ' ' -f 1)" = "$expected_unit_sha"

/usr/bin/node --check "$staging/server.mjs"
/usr/bin/node --check "$staging/comments.mjs"
/usr/bin/node --test "$staging/server.test.mjs" "$staging/comments.test.mjs"
sudo -n systemd-analyze verify "$staging/glossaliae-reactions.service"
python3 - "$staging" <<'PY'
import json
import re
import sys
from pathlib import Path

staging = Path(sys.argv[1])
if json.loads((staging / 'transcriptions.json').read_text()) != json.loads(Path('/opt/glossaliae-reactions/transcriptions.json').read_text()):
    raise SystemExit('Transcription manifest differs from the active one')
if not re.fullmatch(r'COMMENTS_ADMIN_PASSWORD_HASH=scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}\n', (staging / 'comments-admin.env').read_text()):
    raise SystemExit('Invalid private password hash configuration')
PY
sudo -n /usr/bin/node --input-type=module - "$staging/server.mjs" <<'NODE'
import { pathToFileURL } from 'node:url';

const { createReactionServer } = await import(pathToFileURL(process.argv[2]).href);
createReactionServer({ storagePath: '/var/lib/glossaliae-reactions/reactions.json', allowedOrigin: 'https://glossalia-explorer.tuqo.ru' });
createReactionServer({ storagePath: '/var/lib/glossaliae-reactions-local/reactions.json', environment: 'local' });
process.stdout.write('Both existing vote stores validated without writing\n');
NODE
curl -fsS --max-time 5 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null

backup=$(sudo -n mktemp -d "/var/backups/glossaliae-comments-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
sudo -n chmod 0700 "$backup"
sudo -n install -o root -g root -m 0600 /opt/glossaliae-reactions/server.mjs "$backup/server.mjs"
sudo -n install -o root -g root -m 0600 /opt/glossaliae-reactions/transcriptions.json "$backup/transcriptions.json"
sudo -n install -o root -g root -m 0600 /etc/systemd/system/glossaliae-reactions.service "$backup/production.service"
sudo -n install -o root -g root -m 0600 /etc/caddy/Caddyfile "$backup/Caddyfile"
production_votes_sha=$(sudo -n sha256sum /var/lib/glossaliae-reactions/reactions.json | cut -d ' ' -f 1)
local_votes_sha=$(sudo -n sha256sum /var/lib/glossaliae-reactions-local/reactions.json | cut -d ' ' -f 1)

sudo -n python3 - "$staging" "$backup/Caddyfile.candidate" <<'PY'
import re
import sys
from pathlib import Path

staging = Path(sys.argv[1])
unit = Path('/etc/systemd/system/glossaliae-reactions.service').read_text()
candidate_unit = (staging / 'glossaliae-reactions.service').read_text()
env_line = 'EnvironmentFile=-/etc/glossaliae-reactions/comments-admin.env\n'
if candidate_unit.count(env_line) != 1 or candidate_unit.replace(env_line, '') != unit:
    raise SystemExit('Unexpected production unit changes')
source = Path('/etc/caddy/Caddyfile').read_text()
snippet = (staging / 'Caddy-comments-route.caddy').read_text().rstrip() + '\n'
headers = list(re.finditer(r'(?m)^94-232-41-163\.sslip\.io[ \t]+\{[ \t]*$', source))
if len(headers) != 1 or '@glossaliae_comments' in source:
    raise SystemExit('Unexpected Caddy host or existing comments route')
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
markers = list(re.finditer(r'(?m)^[ \t]*@glossaliae_reactions[ \t]+path[ \t]+/glossaliae/reactions[ \t]*$', source[start:end]))
if len(markers) != 1:
    raise SystemExit('Production matcher is not unique inside the selected host')
position = start + markers[0].start()
candidate = source[:position] + snippet + '\n' + source[position:]
if candidate[:start] != source[:start] or candidate[end + len(snippet) + 1:] != source[end:]:
    raise SystemExit('Unexpected changes outside the selected host')
Path(sys.argv[2]).write_bytes(candidate.encode('utf-8'))
PY
sudo -n caddy validate --config "$backup/Caddyfile.candidate" --adapter caddyfile

code_changed=0
env_changed=0
unit_changed=0
caddy_changed=0
completed=0
rollback() {
  status=$1
  trap - EXIT HUP INT TERM
  test "$completed" -eq 0 || exit "$status"
  set +e
  rollback_ok=1
  if test "$caddy_changed" -eq 1; then
    sudo -n install -o root -g caddy -m 0640 "$backup/Caddyfile" /etc/caddy/Caddyfile || rollback_ok=0
  fi
  if test "$unit_changed" -eq 1; then
    sudo -n install -o root -g root -m 0644 "$backup/production.service" /etc/systemd/system/glossaliae-reactions.service || rollback_ok=0
    sudo -n systemctl daemon-reload || rollback_ok=0
  fi
  if test "$code_changed" -eq 1; then
    sudo -n install -o root -g root -m 0644 "$backup/server.mjs" /opt/glossaliae-reactions/server.mjs || rollback_ok=0
    if sudo -n test -e /opt/glossaliae-reactions/comments.mjs; then
      sudo -n mv /opt/glossaliae-reactions/comments.mjs "$backup/comments.mjs.rolled-back" || rollback_ok=0
    fi
    sudo -n systemctl restart glossaliae-reactions.service glossaliae-reactions-local.service || rollback_ok=0
  fi
  if test "$env_changed" -eq 1 && sudo -n test -e /etc/glossaliae-reactions; then
    sudo -n mv /etc/glossaliae-reactions "$backup/private-config.rolled-back" || rollback_ok=0
  fi
  if test "$caddy_changed" -eq 1; then
    sudo -n systemctl restart caddy.service || rollback_ok=0
  fi
  curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8791/glossaliae/reactions >/dev/null || rollback_ok=0
  curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8792/glossaliae/reactions-local >/dev/null || rollback_ok=0
  printf 'Deployment failed; rollback checks passed=%s; private backup=%s\n' "$rollback_ok" "$backup" >&2
  test "$status" -ne 0 || status=1
  exit "$status"
}
trap 'rollback $?' EXIT
trap 'exit 1' HUP INT TERM

# Повторная сверка защищает от изменения конфигурации во время предварительных проверок
test "$(sudo -n sha256sum /opt/glossaliae-reactions/server.mjs | cut -d ' ' -f 1)" = "$expected_server_sha"
test "$(sudo -n sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = "$expected_caddy_sha"
test "$(sudo -n sha256sum /etc/systemd/system/glossaliae-reactions.service | cut -d ' ' -f 1)" = "$expected_unit_sha"
code_changed=1
sudo -n install -o root -g root -m 0644 "$staging/comments.mjs" /opt/glossaliae-reactions/comments.mjs
sudo -n install -o root -g root -m 0644 "$staging/server.mjs" /opt/glossaliae-reactions/server.mjs
env_changed=1
sudo -n install -d -o root -g root -m 0700 /etc/glossaliae-reactions
sudo -n install -o root -g root -m 0600 "$staging/comments-admin.env" /etc/glossaliae-reactions/comments-admin.env
sudo -n mv "$staging/comments-admin.env" "$backup/comments-admin.env.installed"
sudo -n chown root:root "$backup/comments-admin.env.installed"
sudo -n chmod 0600 "$backup/comments-admin.env.installed"
unit_changed=1
sudo -n install -o root -g root -m 0644 "$staging/glossaliae-reactions.service" /etc/systemd/system/glossaliae-reactions.service
sudo -n systemctl daemon-reload
sudo -n systemctl restart glossaliae-reactions.service glossaliae-reactions-local.service
curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8791/glossaliae/comments?key=for-ai >/dev/null
curl -fsS --max-time 3 http://127.0.0.1:8791/glossaliae/reactions >/dev/null
curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8792/glossaliae/reactions-local >/dev/null

caddy_changed=1
sudo -n install -o root -g caddy -m 0640 "$backup/Caddyfile.candidate" /etc/caddy/Caddyfile
# У Caddy отключён административный API, поэтому применение требует перезапуска службы
sudo -n systemctl restart caddy.service
curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 --resolve 94-232-41-163.sslip.io:443:127.0.0.1 https://94-232-41-163.sslip.io/glossaliae/comments?key=for-ai >/dev/null
curl -fsS --max-time 5 -H 'X-Sheepfold-Client-IP: 127.0.0.1' http://127.0.0.1:8790/v1/health >/dev/null
for service in caddy.service sheepfold-message-relay.service glossaliae-reactions.service glossaliae-reactions-local.service; do
  systemctl is-active --quiet "$service"
done
test "$production_votes_sha" = "$(sudo -n sha256sum /var/lib/glossaliae-reactions/reactions.json | cut -d ' ' -f 1)"
test "$local_votes_sha" = "$(sudo -n sha256sum /var/lib/glossaliae-reactions-local/reactions.json | cut -d ' ' -f 1)"
completed=1
printf 'Hidden comments enabled; both vote stores unchanged; private backup=%s\n' "$backup"
