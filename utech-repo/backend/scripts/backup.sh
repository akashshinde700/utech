#!/usr/bin/env bash
# Back up everything that cannot be rebuilt from the repository: the database
# and the uploaded files. Run it on the server.
#
#   DATABASE_URL='mysql://user:pass@host:3306/db' ./scripts/backup.sh [target-dir]
#
# Reads DATABASE_URL (the same variable the app uses) so there is no second
# place to keep credentials. Writes <target-dir>/utech-<timestamp>.sql.gz and
# utech-uploads-<timestamp>.tar.gz, then prints what it wrote.
#
# See docs/BACKUP_AND_RESTORE.md for the restore side and the drill that
# verified these exact commands.
set -euo pipefail

TARGET_DIR="${1:-/var/backups/utech}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Export it (or source the backend .env) and run again." >&2
  exit 1
fi

# mysql://user:password@host:port/database -> the four parts mysqldump wants.
# Done with the shell rather than a Node dependency so this keeps working even
# when node_modules is mid-deploy.
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

mkdir -p "$TARGET_DIR"
SQL_FILE="$TARGET_DIR/utech-$STAMP.sql.gz"

# --single-transaction keeps the dump consistent without locking the plant out
# of the ERP while it runs. _prisma_migrations is an ordinary table, so it is
# included and the restored database already knows which migrations it has.
#
# --get-server-public-key is not optional on this server: the database account
# uses caching_sha2_password, and over a plain TCP connection the client has to
# ask the server for its RSA public key first. Without it mysqldump stops with
# "2061: Authentication requires secure connection" -- while the application
# keeps working, because Prisma's own driver handles that handshake. The first
# version of this script was missing the flag, and the empty archive it left
# behind still looked like a backup.
MYSQL_PWD="$DB_PASS" mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --get-server-public-key \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  --databases "$DB_NAME" | gzip -9 > "$SQL_FILE"

# `set -o pipefail` at the top is what makes a failed mysqldump fail this
# script: the exit status of `mysqldump | gzip` is gzip's, and gzip compresses
# an empty stream without complaint.

# A dump is only a backup once it has been read back. Verify the archive is
# intact, holds the tables, and ends with mysqldump's own completion marker --
# a dump that died mid-write does not.
gzip -t "$SQL_FILE"
TABLES="$(zcat "$SQL_FILE" | grep -c '^CREATE TABLE')"
if [ "$TABLES" -lt 50 ]; then
  echo "ABORT: $SQL_FILE holds only $TABLES tables -- that is not a full backup." >&2
  exit 1
fi
if ! zcat "$SQL_FILE" | tail -2 | grep -q 'Dump completed'; then
  echo "ABORT: $SQL_FILE has no 'Dump completed' marker -- it was truncated." >&2
  exit 1
fi

echo "database -> $SQL_FILE ($(du -h "$SQL_FILE" | cut -f1), $TABLES tables, verified)"

# Attachments live on disk; the database only stores their filenames, so a
# database-only backup restores an ERP whose drawings all 404.
if [ -d "$UPLOAD_DIR" ]; then
  UPLOADS_FILE="$TARGET_DIR/utech-uploads-$STAMP.tar.gz"
  tar -czf "$UPLOADS_FILE" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "uploads  -> $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"
else
  echo "uploads  -> SKIPPED: $UPLOAD_DIR does not exist (set UPLOAD_DIR)" >&2
fi

# Keep 14 days. Adjust deliberately — this is the whole retention policy.
find "$TARGET_DIR" -name 'utech-*.gz' -mtime +14 -print -delete
