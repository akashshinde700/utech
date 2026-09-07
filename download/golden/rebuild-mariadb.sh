#!/usr/bin/env bash
# rebuild-mariadb.sh — user-space MariaDB (re)builder for the UTech ERP.
# Task-13 layout (Task 10 "bulletproof" paths, all under the watched project):
#   debs   /home/z/my-project/mariadb-debs   (auto-downloads from trixie if missing)
#   root   /home/z/my-project/mariadb/root   (mariadb-server-core + client-core)
#   libs   /home/z/my-project/mariadb/libs   (liburing2/libaio1t64/libncurses6/libtinfo6)
#   data   /home/z/my-project/mariadb/data   (datadir)
#   socket /home/z/my-project/mariadb/mysqld.sock
#
#   build   extract debs + mariadb-install-db ONLY if datadir missing/empty
#   ensure  require 3306 up; ensure db `utech` + user utech/utech123; AUTO-RESTORE
#           newest backup if `utech` has no tables; prisma migrate deploy + seed
#   restore <file>  require 3306 up; pipe dump (raw .sql or .sql.gz) into mariadb -uroot
#   (none)  build + start mariadbd if 3306 down + ensure  (manual/interactive use)
#
# BACKUPS: /home/z/my-project/backups/utech-<ts>.sql.gz (watchdog dumps every ~6h,
#          keeps newest 5; see src/instrumentation.ts).
#
# DATA SAFETY: never touches/deletes a populated datadir — installs into a
# missing or empty one only. Auto-restore NEVER overwrites a non-empty DB
# (only fires when `utech` has zero tables). Migrations + seed are idempotent upserts.
#
# WATCHDOG HANDOVER (manual use): mariadbd started by the `all` mode is a
# child of this shell. Hand it to the Next.js watchdog so it survives:
#   pkill -x mariadbd; sleep 30
# then verify: ps -o pid,ppid,cmd | grep mariadbd  -> PPID must be next-server.
set -e
DEBS=/home/z/my-project/mariadb-debs
BASE=/home/z/my-project/mariadb
ROOT=$BASE/root
LIBS=$BASE/libs
DATA=$BASE/data
SOCK=$BASE/mysqld.sock
BACKUPS=/home/z/my-project/backups
export LD_LIBRARY_PATH=$LIBS/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

# 0) Debs present? If not, re-download (Debian trixie).
#    mariadb-client is REQUIRED: it ships mariadb-dump (client-core does not).
if ! ls "$DEBS"/mariadb-server-core_*.deb "$DEBS"/mariadb-client_*.deb >/dev/null 2>&1; then
  echo "rebuild-mariadb.sh: debs missing — downloading from deb.debian.org"
  mkdir -p "$DEBS"
  (cd "$DEBS" && apt-get download mariadb-server-core mariadb-client-core mariadb-client liburing2 libaio1t64 libncurses6 libtinfo6)
fi

do_build() {
  mkdir -p "$ROOT" "$LIBS"
  for d in "$DEBS"/mariadb-server-core_*.deb "$DEBS"/mariadb-client-core_*.deb "$DEBS"/mariadb-client_*.deb; do dpkg -x "$d" "$ROOT"; done
  for d in "$DEBS"/liburing2_*.deb "$DEBS"/libaio1t64_*.deb "$DEBS"/libncurses6_*.deb "$DEBS"/libtinfo6_*.deb; do dpkg -x "$d" "$LIBS"; done
  # Init datadir ONLY if missing/empty (never re-init an existing populated one).
  if [ ! -d "$DATA" ] || [ -z "$(ls -A "$DATA" 2>/dev/null)" ]; then
    echo "rebuild-mariadb.sh: datadir missing/empty — running mariadb-install-db"
    "$ROOT/usr/bin/mariadb-install-db" --no-defaults --basedir="$ROOT/usr" --datadir="$DATA" \
      --auth-root-authentication-method=normal --skip-test-db
  else
    echo "rebuild-mariadb.sh: datadir already populated — leaving untouched"
  fi
}

do_ensure() {
  ss -ltn 2>/dev/null | grep -q ':3306 ' || { echo "rebuild-mariadb.sh: ensure aborted, 3306 down"; exit 1; }
  "$ROOT/usr/bin/mariadb" -uroot -S "$SOCK" -e "CREATE DATABASE IF NOT EXISTS utech; CREATE USER IF NOT EXISTS 'utech'@'localhost' IDENTIFIED BY 'utech123'; CREATE USER IF NOT EXISTS 'utech'@'%' IDENTIFIED BY 'utech123'; GRANT ALL PRIVILEGES ON utech.* TO 'utech'@'localhost'; GRANT ALL PRIVILEGES ON utech.* TO 'utech'@'%'; FLUSH PRIVILEGES;"
  # Task 13-b AUTO-RESTORE: if `utech` has NO tables and a watchdog backup exists,
  # restore the newest dump BEFORE migrations (a restored dump already carries
  # schema + prisma migration history). A non-empty DB is NEVER overwritten.
  TABLE_COUNT=$($ROOT/usr/bin/mariadb --no-defaults -uroot -S "$SOCK" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='utech';" 2>/dev/null || echo 0)
  if [ "${TABLE_COUNT:-0}" -eq 0 ] 2>/dev/null; then
    NEWEST_DUMP=$(ls -1t "$BACKUPS"/utech-*.sql.gz 2>/dev/null | head -n 1 || true)
    if [ -n "$NEWEST_DUMP" ]; then
      echo "rebuild-mariadb.sh: utech DB empty — auto-restoring newest backup: $NEWEST_DUMP"
      do_restore "$NEWEST_DUMP"
    else
      echo "rebuild-mariadb.sh: utech DB empty and no backups in $BACKUPS — nothing to auto-restore"
    fi
  else
    echo "rebuild-mariadb.sh: utech DB has ${TABLE_COUNT} table(s) — auto-restore skipped (never overwrite data)"
  fi
  export DATABASE_URL="mysql://utech:utech123@127.0.0.1:3306/utech"
  cd /home/z/my-project/utech-repo/backend
  if [ -x node_modules/.bin/prisma ]; then
    node_modules/.bin/prisma migrate deploy
  else
    bunx prisma migrate deploy
  fi
  node prisma/seed.js
}

# do_restore <dumpfile> — pipe a dump (.sql or .sql.gz) into the running server
# via the unix socket as root. Dumps made by the watchdog use --databases utech,
# so they carry their own CREATE DATABASE/USE statements. Runs in a subshell
# with pipefail so a corrupt dump OR a mariadb failure is reported.
do_restore() {
  local dump="$1"
  if [ ! -f "$dump" ]; then echo "rebuild-mariadb.sh: restore: dump not found: $dump"; return 1; fi
  ss -ltn 2>/dev/null | grep -q ':3306 ' || { echo "rebuild-mariadb.sh: restore aborted, 3306 down (run '$0 all' first)"; return 1; }
  echo "rebuild-mariadb.sh: restoring dump: $dump"
  if (
    set -o pipefail
    case "$dump" in
      *.gz) gunzip -c "$dump" ;;
      *)    cat "$dump" ;;
    esac | $ROOT/usr/bin/mariadb --no-defaults -uroot -S "$SOCK"
  ); then
    echo "rebuild-mariadb.sh: restore finished OK: $dump"
  else
    echo "rebuild-mariadb.sh: restore FAILED: $dump"
    return 1
  fi
}

case "${1:-all}" in
  build)
    do_build
    ;;
  ensure)
    do_ensure
    ;;
  restore)
    shift
    dump_file="${1:-}"
    [ -n "$dump_file" ] || { echo "usage: $0 restore <dumpfile[.sql.gz]>"; exit 2; }
    do_restore "$dump_file"
    ;;
  all)
    do_build
    if ! ss -ltn 2>/dev/null | grep -q ':3306 '; then
      nohup "$ROOT/usr/sbin/mariadbd" --no-defaults --basedir="$ROOT/usr" --datadir="$DATA" \
        --socket="$SOCK" --port=3306 --bind-address=127.0.0.1 --skip-networking=0 \
        > "$BASE/start.log" 2>&1 &
      for i in $(seq 1 30); do ss -ltn 2>/dev/null | grep -q ':3306 ' && break; sleep 1; done
      ss -ltn 2>/dev/null | grep -q ':3306 ' || { echo "mariadbd failed to start"; tail -n 20 "$BASE/start.log"; exit 1; }
    fi
    do_ensure
    ;;
  *)
    echo "usage: $0 [build|ensure|all|restore <dumpfile>]"; exit 2
    ;;
esac
echo "rebuild-mariadb.sh[$1]: OK"
