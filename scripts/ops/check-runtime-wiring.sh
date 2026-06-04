#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
POSTGRES_SERVICE=${POSTGRES_SERVICE:-postgres}
REDIS_SERVICE=${REDIS_SERVICE:-redis}

cd "$ROOT_DIR"

printf '%s\n' 'Checking compose configuration...'
$COMPOSE config >/dev/null

printf '%s\n' 'Checking PostgreSQL credentials inside the postgres container...'
$COMPOSE exec -T "$POSTGRES_SERVICE" sh -lc '
  set -eu
  : "${POSTGRES_USER:?POSTGRES_USER is required}"
  : "${POSTGRES_DB:?POSTGRES_DB is required}"
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1" >/dev/null
'

printf '%s\n' 'Checking Redis password requirement inside the redis container...'
$COMPOSE exec -T "$REDIS_SERVICE" sh -lc '
  set -eu
  : "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PING | grep -q PONG
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning CONFIG GET requirepass | grep -Fq "$REDIS_PASSWORD"
'

printf '%s\n' 'Checking app-facing service health endpoint...'
$COMPOSE exec -T api sh -lc 'wget -qO- http://127.0.0.1:3000/health >/dev/null'

printf '%s\n' 'Runtime wiring check passed.'
