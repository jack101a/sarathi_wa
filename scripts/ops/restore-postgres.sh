#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/ops/restore-postgres.sh /path/to/pg_backup.dump --dry-run
  CONFIRM_RESTORE=YES_I_UNDERSTAND scripts/ops/restore-postgres.sh /path/to/pg_backup.dump

Required environment:
  PGHOST
  PGPORT        optional, defaults to 5432
  PGDATABASE
  PGUSER
  PGPASSWORD   or a valid .pgpass file

Safety:
  This script is for maintenance windows only.
  Stop app/worker/scheduler containers before a real restore.
  It restores with --clean --if-exists, so existing database objects may be replaced.
USAGE
}

BACKUP_FILE="${1:-}"
MODE="${2:-}"

if [[ -z "$BACKUP_FILE" || "$BACKUP_FILE" == "-h" || "$BACKUP_FILE" == "--help" ]]; then
  usage
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

for name in PGHOST PGDATABASE PGUSER; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name" >&2
    exit 1
  fi
done

export PGPORT="${PGPORT:-5432}"

echo "Target database:"
echo "  host=$PGHOST"
echo "  port=$PGPORT"
echo "  database=$PGDATABASE"
echo "  user=$PGUSER"
echo "  backup=$BACKUP_FILE"

if [[ "$MODE" == "--dry-run" ]]; then
  echo "Dry run: listing backup contents only."
  pg_restore --list "$BACKUP_FILE" >/dev/null
  echo "Dry run passed: backup file is readable by pg_restore."
  exit 0
fi

if [[ "${CONFIRM_RESTORE:-}" != "YES_I_UNDERSTAND" ]]; then
  echo "Refusing restore without CONFIRM_RESTORE=YES_I_UNDERSTAND" >&2
  echo "Run --dry-run first, stop application containers, then rerun with confirmation." >&2
  exit 1
fi

echo "Starting PostgreSQL restore..."
pg_restore \
  --host "$PGHOST" \
  --port "$PGPORT" \
  --username "$PGUSER" \
  --dbname "$PGDATABASE" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

echo "PostgreSQL restore completed."
