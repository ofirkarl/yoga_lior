#!/usr/bin/env bash
# מריץ את הסכמה והבדיקות על Postgres מקומי זמני
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d)
RUN_AS=${RUN_AS:-}
pg() { if [ -n "$RUN_AS" ]; then su "$RUN_AS" -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 777 "$DIR"
pg "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
pg "$PGBIN/pg_ctl -D $DIR/data -o '-k $DIR -c listen_addresses= -c timezone=Asia/Jerusalem' -l $DIR/log -w start >/dev/null"
trap 'pg "$PGBIN/pg_ctl -D $DIR/data -m immediate stop >/dev/null"; rm -rf "$DIR"' EXIT
PSQL="psql -h $DIR -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f supabase/tests/supabase_shim.sql
$PSQL -f supabase/migrations/0001_init.sql
$PSQL -f supabase/seed.sql
$PSQL -t -f supabase/tests/security_test.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //' | grep -E 'ok:|FAIL|ERROR|עברו' || true
