#!/usr/bin/env bash
# rebuild-mariadb.sh — user-space MariaDB restore for the UTech ERP.
# Idempotent: extracts MariaDB debs into /home/z/mariadb/{root,libs}, inits the
# datadir if missing, starts mariadbd on 127.0.0.1:3306 (socket
# /home/z/mariadb/mysqld.sock) if 3306 is down, creates DB `utech` + user
# utech/utech123, then runs prisma migrate deploy + seed in utech-repo/backend.
#
# POST-RUN WATCHDOG HANDOVER (IMPORTANT): mariadbd started here dies with your
# shell session. Hand it to the Next.js watchdog so it survives:
#   pkill -x mariadbd; sleep 30
# then verify: ps -o pid,ppid,cmd | grep mariadbd   -> PPID must be next-server's pid.
set -e
DEBS=/home/z/mariadb-debs
ROOT=/home/z/mariadb/root
LIBS=/home/z/mariadb/libs
DATA=/home/z/mariadb/data
SOCK=/home/z/mariadb/mysqld.sock
export LD_LIBRARY_PATH=$LIBS/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

# 1) Extract debs
mkdir -p "$ROOT" "$LIBS"
for d in "$DEBS"/mariadb-server-core_*.deb "$DEBS"/mariadb-client-core_*.deb; do dpkg -x "$d" "$ROOT"; done
for d in "$DEBS"/liburing2_*.deb "$DEBS"/libaio1t64_*.deb "$DEBS"/libncurses6_*.deb "$DEBS"/libtinfo6_*.deb; do dpkg -x "$d" "$LIBS"; done

# 2) Init datadir only if missing/empty
if [ ! -d "$DATA" ] || [ -z "$(ls -A "$DATA" 2>/dev/null)" ]; then
  "$ROOT/usr/bin/mariadb-install-db" --no-defaults --basedir="$ROOT/usr" --datadir="$DATA" --auth-root-authentication-method=normal --skip-test-db
fi

# 3) Start mariadbd if 3306 not listening
if ! (ss -ltn 2>/dev/null | grep -q ':3306 '); then
  nohup "$ROOT/usr/sbin/mariadbd" --no-defaults --basedir="$ROOT/usr" --datadir="$DATA" \
    --socket="$SOCK" --port=3306 --bind-address=127.0.0.1 --skip-networking=0 \
    > /home/z/mariadb/start.log 2>&1 &
  for i in $(seq 1 30); do ss -ltn 2>/dev/null | grep -q ':3306 ' && break; sleep 1; done
  ss -ltn 2>/dev/null | grep -q ':3306 ' || { echo "mariadbd failed to start"; tail -n 20 /home/z/mariadb/start.log; exit 1; }
fi

# 4) Ensure database + user
"$ROOT/usr/bin/mariadb" -uroot -S "$SOCK" -e "CREATE DATABASE IF NOT EXISTS utech; CREATE USER IF NOT EXISTS 'utech'@'localhost' IDENTIFIED BY 'utech123'; CREATE USER IF NOT EXISTS 'utech'@'%' IDENTIFIED BY 'utech123'; GRANT ALL PRIVILEGES ON utech.* TO 'utech'@'localhost'; GRANT ALL PRIVILEGES ON utech.* TO 'utech'@'%'; FLUSH PRIVILEGES;"

# 5) Migrate + seed
export DATABASE_URL="mysql://utech:utech123@127.0.0.1:3306/utech"
cd /home/z/my-project/utech-repo/backend
bunx prisma migrate deploy
node prisma/seed.js
echo "rebuild-mariadb.sh: done. Now perform watchdog handover: pkill -x mariadbd; sleep 30"
