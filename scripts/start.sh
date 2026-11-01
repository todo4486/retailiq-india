#!/bin/bash
# Start MySQL, the Flask API (port 5050) and the Vite frontend (port 5173).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -x "$ROOT/.mysql/server/bin/mysqld" ]; then
  "$ROOT/scripts/mysql.sh" start
fi

(cd "$ROOT/backend" && "$ROOT/backend/.venv/bin/python" app.py) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

cd "$ROOT/frontend"
npm run dev
