#!/bin/bash
# One-time setup: MySQL (local copy, no admin rights), Python venv, npm packages, datasets.
# Set RETAILIQ_SKIP_MYSQL=1 and fill in backend/.env to use a MySQL server you already run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MYSQL_VERSION="8.4.10"
MYSQL_PKG="mysql-${MYSQL_VERSION}-macos15-arm64"
MYSQL_HOME="$ROOT/.mysql"
ENV_FILE="$ROOT/backend/.env"
PY="$ROOT/backend/.venv/bin/python"

echo "== Python environment"
[ -x "$PY" ] || python3 -m venv "$ROOT/backend/.venv"
"$PY" -m pip install -q --upgrade pip
"$PY" -m pip install -q -r "$ROOT/backend/requirements.txt"

if [ -z "${RETAILIQ_SKIP_MYSQL:-}" ]; then
  echo "== MySQL ${MYSQL_VERSION}"
  if [ ! -x "$MYSQL_HOME/server/bin/mysqld" ]; then
    mkdir -p "$MYSQL_HOME/download"
    curl -fL -o "$MYSQL_HOME/download/mysql.tar.gz" "https://cdn.mysql.com/Downloads/MySQL-8.4/${MYSQL_PKG}.tar.gz"
    tar -xzf "$MYSQL_HOME/download/mysql.tar.gz" -C "$MYSQL_HOME"
    mv "$MYSQL_HOME/$MYSQL_PKG" "$MYSQL_HOME/server"
    rm "$MYSQL_HOME/download/mysql.tar.gz"
  fi
  if [ ! -d "$MYSQL_HOME/data/mysql" ]; then
    "$MYSQL_HOME/server/bin/mysqld" --no-defaults --initialize-insecure --datadir="$MYSQL_HOME/data" --basedir="$MYSQL_HOME/server"
  fi
  [ -f "$ENV_FILE" ] || cat > "$ENV_FILE" <<EOF
RETAILIQ_DB_HOST=127.0.0.1
RETAILIQ_DB_PORT=3307
RETAILIQ_DB_USER=retailiq
RETAILIQ_DB_PASSWORD=$(openssl rand -hex 16)
RETAILIQ_DB_NAME=retailiq
EOF
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  "$ROOT/scripts/mysql.sh" start
  "$MYSQL_HOME/server/bin/mysql" --no-defaults -uroot -h127.0.0.1 -P3307 --protocol=tcp <<SQL
CREATE DATABASE IF NOT EXISTS retailiq CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'retailiq'@'localhost' IDENTIFIED BY '${RETAILIQ_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'retailiq'@'127.0.0.1' IDENTIFIED BY '${RETAILIQ_DB_PASSWORD}';
GRANT ALL ON retailiq.* TO 'retailiq'@'localhost';
GRANT ALL ON retailiq.* TO 'retailiq'@'127.0.0.1';
SQL
fi

echo "== UCI Online Retail dataset"
if [ ! -f "$ROOT/data/online_retail.csv" ]; then
  mkdir -p "$ROOT/data/raw"
  [ -f "$ROOT/data/raw/Online Retail.xlsx" ] || {
    curl -fL -o "$ROOT/data/raw/online_retail.zip" "https://archive.ics.uci.edu/static/public/352/online+retail.zip"
    unzip -o -q "$ROOT/data/raw/online_retail.zip" -d "$ROOT/data/raw"
  }
  "$PY" -I "$ROOT/backend/scripts/convert_uci_xlsx.py" "$ROOT/data/raw/Online Retail.xlsx" "$ROOT/data/online_retail.csv"
fi

echo "== Synthetic Indian demo dataset"
[ -f "$ROOT/data/retailiq_india_synthetic.csv" ] || "$PY" "$ROOT/backend/scripts/generate_india_data.py" "$ROOT/data/retailiq_india_synthetic.csv"
(cd "$ROOT/backend" && "$PY" scripts/load_demo.py)

echo "== Frontend packages"
(cd "$ROOT/frontend" && npm install --no-fund --no-audit)

echo "Setup complete. Start the app with: scripts/start.sh"
