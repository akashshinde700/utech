#!/usr/bin/env bash
# Restore the database from a backup.sh dump. Run it on the server.
#
#   DATABASE_URL='mysql://user:pass@host:3306/db' ./scripts/restore.sh /var/backups/utech/utech-20261028-140000.sql.gz
#
# This REPLACES the named database. It asks for confirmation unless
# RESTORE_YES=1 is set, because the one thing worse than having no backup is
# restoring over live data by accident.
#
# After it finishes, verify before letting anyone back in:
#   npx prisma migrate status      # must say the schema is up to date
#   npm run db:check-integrity     # must report every cached total as OK
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: DATABASE_URL=... $0 <dump.sql.gz>" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

proto_stripped="${DATABASE_URL#*://}"
credentials="${proto_stripped%@*}"
host_and_db="${proto_stripped##*@}"
DB_USER="${credentials%%:*}"
DB_PASS="${credentials#*:}"
host_port="${host_and_db%%/*}"
DB_NAME="${host_and_db##*/}"
DB_NAME="${DB_NAME%%\?*}"
DB_HOST="${host_port%%:*}"
DB_PORT="${host_port##*:}"
[ "$DB_PORT" = "$DB_HOST" ] && DB_PORT=3306

if [ "${RESTORE_YES:-}" != "1" ]; then
  echo "About to replace database '$DB_NAME' on $DB_HOST with $DUMP."
  printf "Type the database name to continue: "
  read -r answer
  [ "$answer" = "$DB_NAME" ] || { echo "Aborted."; exit 1; }
fi

# The dump carries CREATE DATABASE / USE, so it recreates the database itself.
# Stop the API first so nothing writes into a half-restored schema.
gunzip -c "$DUMP" | MYSQL_PWD="$DB_PASS" mysql \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --default-character-set=utf8mb4

echo "Restored '$DB_NAME' from $DUMP."
echo "Now run:  npx prisma migrate status  &&  npm run db:check-integrity"
