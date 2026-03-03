#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_SESSION="budget-app"
LEGACY_BACKEND_SESSION="budget-backend"
LEGACY_FRONTEND_SESSION="budget-frontend"

kill_session_if_exists() {
  local session_name="$1"
  if tmux has-session -t "$session_name" 2>/dev/null; then
    tmux kill-session -t "$session_name"
  fi
}

kill_session_if_exists "$APP_SESSION"
kill_session_if_exists "$LEGACY_BACKEND_SESSION"
kill_session_if_exists "$LEGACY_FRONTEND_SESSION"

docker compose stop frontend backend >/dev/null 2>&1 || true
docker compose rm -f frontend backend >/dev/null 2>&1 || true

echo "Stopped app sessions and frontend/backend services."
