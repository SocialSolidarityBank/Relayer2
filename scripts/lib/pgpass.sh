# pg_env_from_url <postgres URL>
#
# 연결 문자열을 psql/pg_dump 의 인자로 넘기면 비밀번호가 통째로 `ps` 에 보인다.
# 여기서는 URL 을 쪼개 비밀번호만 임시 PGPASSFILE(0600)에 쓰고,
# host/port/user/db 는 PG* 환경변수로 넘긴다. 만든 파일은 EXIT trap 이 지운다.
#
# URL 에 sslmode 가 있으면 PGSSLMODE 로 이어받는다 — Supabase 는 TLS 가 필요하다.

_PGPASS_FILES=()

_pgpass_cleanup() {
  if ((${#_PGPASS_FILES[@]})); then rm -f "${_PGPASS_FILES[@]}"; fi
}
trap _pgpass_cleanup EXIT

pg_env_from_url() {
  local url="$1" pgpass exports

  # mktemp 뒤 chmod 가 아니라 umask 로 처음부터 0600 으로 만든다 — 사이에 찰나의 틈이 없다.
  umask 077
  pgpass="$(mktemp "${TMPDIR:-/tmp}/pgpass.XXXXXX")"
  _PGPASS_FILES+=("$pgpass")

  # 비밀번호는 파일로만 쓰고 stdout 에는 싣지 않는다. eval 되는 쪽에는 비밀이 없다.
  exports="$(PGPASS_OUT="$pgpass" PG_URL="$url" python3 - <<'PY'
import os, shlex
from urllib.parse import urlsplit, unquote, parse_qsl

u = urlsplit(os.environ["PG_URL"])
host = u.hostname or "localhost"
port = u.port or 5432
user = unquote(u.username or "")
db = unquote(u.path.lstrip("/")) or "postgres"
pw = unquote(u.password or "")

# .pgpass 는 ':' 와 '\' 가 구분자라 값 안의 둘은 이스케이프한다.
def esc(v):
    return v.replace("\\", "\\\\").replace(":", "\\:")

with open(os.environ["PGPASS_OUT"], "w") as f:
    f.write(":".join(esc(x) for x in (host, str(port), db, user, pw)) + "\n")

print("export PGHOST=%s PGPORT=%s PGUSER=%s PGDATABASE=%s" % (
    shlex.quote(host), shlex.quote(str(port)), shlex.quote(user), shlex.quote(db)))

q = dict(parse_qsl(u.query))
if "sslmode" in q:
    print("export PGSSLMODE=%s" % shlex.quote(q["sslmode"]))
PY
)"
  eval "$exports"
  export PGPASSFILE="$pgpass"
}
