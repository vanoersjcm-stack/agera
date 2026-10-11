#!/bin/sh
# Applies /migrations/V<n>__<name>.sql in version order, each exactly once, and records it in
# schema_migrations together with its SHA-256. An applied file that was edited afterwards stops the run.
# Connection settings come from the standard PG* environment variables.
set -eu

DIR=${MIGRATIONS_DIR:-/migrations}
APP_ROLE=${DB_USER:-}
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

q() { psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

until pg_isready -q; do sleep 1; done

q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER      PRIMARY KEY,
    filename   VARCHAR(255) NOT NULL,
    checksum   CHAR(64)     NOT NULL,
    applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
SQL
if [ -n "$APP_ROLE" ]; then
  q -v role="$APP_ROLE" <<'SQL'
REVOKE ALL ON schema_migrations FROM :"role";
SQL
fi

if [ "$(q -c 'SELECT count(*) FROM schema_migrations')" = 0 ] \
  && [ "$(q -c "SELECT to_regclass('public.tenants') IS NOT NULL")" = t ]; then
  echo "migrate: tables exist but schema_migrations is empty; this database was not created by this tool." >&2
  echo "migrate: refusing to guess which migrations are applied. See DEPLOYMENT.md (Troubleshooting)." >&2
  exit 1
fi

files=$(for path in "$DIR"/V*__*.sql; do
  name=${path##*/}
  if echo "$name" | grep -Eq '^V[0-9]+__[A-Za-z0-9_]+\.sql$'; then
    echo "${name%%__*} $name" | sed 's/^V//'
  fi
done | sort -n -k1,1)
if [ -z "$files" ]; then
  echo "migrate: no migrations found in $DIR" >&2
  exit 1
fi
duplicates=$(echo "$files" | cut -d' ' -f1 | uniq -d)
if [ -n "$duplicates" ]; then
  echo "migrate: duplicate migration versions: $duplicates" >&2
  exit 1
fi

echo "$files" | while read -r version name; do
  checksum=$(sha256sum "$DIR/$name" | cut -d' ' -f1)
  recorded=$(q -c "SELECT checksum FROM schema_migrations WHERE version = $version")
  if [ -n "$recorded" ]; then
    if [ "$recorded" != "$checksum" ]; then
      echo "migrate: $name was changed after it was applied (checksum mismatch). Add a new migration instead." >&2
      exit 1
    fi
    continue
  fi
  echo "migrate: applying $name"
  q -f "$DIR/$name"
  q -v version="$version" -v name="$name" -v checksum="$checksum" <<'SQL'
INSERT INTO schema_migrations (version, filename, checksum) VALUES (:version, :'name', :'checksum');
SQL
done
echo "migrate: schema is up to date (latest: $(q -c 'SELECT filename FROM schema_migrations ORDER BY version DESC LIMIT 1'))"
