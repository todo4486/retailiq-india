#!/bin/bash
# Start or stop the project's local MySQL server. Listens on 127.0.0.1:3307 only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="$ROOT/.mysql"
BIN="$HOME_DIR/server/bin"
ping_db() { "$BIN/mysqladmin" --no-defaults -uroot -h127.0.0.1 -P3307 --protocol=tcp ping >/dev/null 2>&1; }

case "${1:-start}" in
  start)
    if lsof -nP -iTCP:3307 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "MySQL is already running on port 3307"
      exit 0
    fi
    "$BIN/mysqld" --no-defaults --basedir="$HOME_DIR/server" --datadir="$HOME_DIR/data" \
      --port=3307 --bind-address=127.0.0.1 --mysqlx=OFF --socket=/tmp/retailiq-mysql.sock \
      --innodb-buffer-pool-size=1G --innodb-flush-log-at-trx-commit=2 \
      --log-error="$HOME_DIR/error.log" --pid-file="$HOME_DIR/mysqld.pid" >/dev/null 2>&1 &
    disown
    for _ in $(seq 1 60); do
      if lsof -nP -iTCP:3307 -sTCP:LISTEN >/dev/null 2>&1; then
        echo "MySQL started on port 3307"
        exit 0
      fi
      sleep 1
    done
    echo "MySQL did not start. See $HOME_DIR/error.log" >&2
    exit 1
    ;;
  stop)
    "$BIN/mysqladmin" --no-defaults -uroot -h127.0.0.1 -P3307 --protocol=tcp shutdown
    echo "MySQL stopped"
    ;;
  status)
    ping_db && echo "running" || echo "stopped"
    ;;
  *)
    echo "Usage: scripts/mysql.sh start|stop|status" >&2
    exit 2
    ;;
esac
