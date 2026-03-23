#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== SapienX Upgrade ==="
cd "$PROJECT_DIR"

echo "Pulling latest..."
git pull origin main

echo "Installing dependencies..."
npm install

echo "Running migrations..."
MIGRATION_DIR="$PROJECT_DIR/scripts/migrations"
SAPIENX_HOME="${SAPIENX_HOME:-$HOME/.sapienx}"
MIGRATION_LOG="$SAPIENX_HOME/data/.migrations"
mkdir -p "$SAPIENX_HOME/data"
touch "$MIGRATION_LOG"
if [ -d "$MIGRATION_DIR" ]; then
  for migration in "$MIGRATION_DIR"/*.js; do
    [ -f "$migration" ] || continue
    name=$(basename "$migration")
    if ! grep -q "$name" "$MIGRATION_LOG" 2>/dev/null; then
      echo "  Running: $name"
      node "$migration" && echo "$name" >> "$MIGRATION_LOG"
    fi
  done
fi

echo "Restarting..."
if command -v pm2 &> /dev/null; then
  pm2 restart sapienx || pm2 start ecosystem.config.js
else
  echo "pm2 not found. Restart manually: sapienx start"
fi

echo "=== Upgrade complete ==="
