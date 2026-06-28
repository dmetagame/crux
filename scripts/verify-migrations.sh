#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="crux-migration-check-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run \
  --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -d postgres:16 >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  echo "Postgres did not become ready in time." >&2
  exit 1
fi

docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;

create publication supabase_realtime;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
done

echo "All Supabase migrations applied cleanly."
