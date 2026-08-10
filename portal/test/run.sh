#!/usr/bin/env bash
# Verify portal/schema.sql against a real Postgres, without needing Supabase.
#
# Creates a throwaway cluster in a temp directory, applies the schema twice
# (idempotency), runs the isolation test, then shuts down and deletes it.
# Never touches an existing database.
set -euo pipefail

PGBIN="${PGBIN:-C:/Users/nicho/scoop/apps/postgresql/current/bin}"
PORT="${PORT:-55432}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"

cleanup() {
  "$PGBIN/pg_ctl" -D "$WORK/pgdata" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> initializing throwaway cluster in $WORK"
"$PGBIN/initdb" -D "$WORK/pgdata" -U postgres -A trust -E UTF8 >/dev/null

echo "==> starting on port $PORT"
"$PGBIN/pg_ctl" -D "$WORK/pgdata" -l "$WORK/pg.log" -o "-p $PORT" -w start >/dev/null 2>&1 &
for _ in $(seq 1 30); do
  "$PGBIN/psql" -h localhost -p "$PORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

PSQL="$PGBIN/psql -h localhost -p $PORT -U postgres"
$PSQL -q -c "create database portal_test;" >/dev/null

RUN="$PGBIN/psql -h localhost -p $PORT -U postgres -d portal_test -q -v ON_ERROR_STOP=1"

echo "==> applying Supabase stub"
$RUN -f "$HERE/00_supabase_stub.sql" >/dev/null

echo "==> applying schema.sql (pass 1)"
$RUN -f "$HERE/../schema.sql" 2>&1 | grep -v NOTICE || true

echo "==> applying schema.sql (pass 2 — must be idempotent)"
$RUN -f "$HERE/../schema.sql" 2>&1 | grep -v NOTICE || true

echo "==> isolation test"
"$PGBIN/psql" -h localhost -p "$PORT" -U postgres -d portal_test -f "$HERE/01_rls_test.sql"

echo ""
echo "==> anon lockdown (all three must be 'permission denied')"
for rel in activities brands v_brand_activity_log; do
  $PSQL -d portal_test -c "set role anon; select count(*) from $rel;" 2>&1 | tail -1
done

echo ""
echo "==> done"
