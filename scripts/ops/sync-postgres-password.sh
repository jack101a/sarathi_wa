#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
COMPOSE="$ROOT_DIR/scripts/compose.sh"
POSTGRES_SERVICE=${POSTGRES_SERVICE:-postgres}
DB_USER=${POSTGRES_APP_USER:-sarathi}

cd "$ROOT_DIR"

printf '%s\n' "Syncing PostgreSQL role password for user '$DB_USER' from the current postgres container environment..."
$COMPOSE exec -T "$POSTGRES_SERVICE" env POSTGRES_APP_USER="$DB_USER" sh -lc '
  set -eu
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
  : "${POSTGRES_USER:?POSTGRES_USER is required}"
  : "${POSTGRES_DB:?POSTGRES_DB is required}"
  : "${POSTGRES_APP_USER:?POSTGRES_APP_USER is required}"
  psql -v ON_ERROR_STOP=1 \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -v app_user="$POSTGRES_APP_USER" \
    -v app_pass="$POSTGRES_PASSWORD" \
    -c "ALTER ROLE :\"app_user\" WITH PASSWORD :'app_pass';"
'

printf '%s\n' 'Password sync complete. Restart app containers so all pools reconnect with the current env password.'
printf '%s\n' 'Suggested: ./scripts/compose.sh up -d --force-recreate api gateway-tg gateway-wa worker-api worker-browser scheduler'
