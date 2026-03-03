#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_SESSION="budget-app"
LEGACY_BACKEND_SESSION="budget-backend"
LEGACY_FRONTEND_SESSION="budget-frontend"
MODE="${START_MODE:-docker}"

if [[ $# -gt 0 ]]; then
  case "$1" in
    --docker)
      MODE="docker"
      ;;
    --docker-fast|--fast)
      MODE="docker-fast"
      ;;
    --local)
      MODE="local"
      ;;
    *)
      echo "Unknown mode: $1"
      echo "Usage: ./start_app.sh [--docker|--docker-fast|--local]"
      exit 1
      ;;
  esac
fi

get_env_value() {
  local key="$1"
  local fallback="$2"
  if [[ -f .env ]] && grep -q "^${key}=" .env; then
    grep "^${key}=" .env | tail -n1 | cut -d'=' -f2-
  else
    echo "$fallback"
  fi
}

BACKEND_PORT="$(get_env_value "BACKEND_PORT" "8000")"
FRONTEND_PORT="$(get_env_value "FRONTEND_PORT" "5173")"

port_in_use() {
  local port="$1"
  lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

pick_backend_port() {
  local preferred="$1"
  shift

  if ! port_in_use "$preferred"; then
    echo "$preferred"
    return
  fi

  for candidate in "$@"; do
    if ! port_in_use "$candidate"; then
      echo "$candidate"
      return
    fi
  done

  echo "$preferred"
}

SELECTED_BACKEND_PORT="$(pick_backend_port "$BACKEND_PORT" 58010 18000 28000)"
SELECTED_FRONTEND_PORT="$FRONTEND_PORT"

configure_tmux() {
  tmux set-option -g mouse on
  tmux set-option -g status-keys vi
  tmux set-window-option -g mode-keys vi
  tmux set-option -g history-limit 100000
  tmux set-option -g renumber-windows on
}

stop_compose_services() {
  docker compose stop frontend backend >/dev/null 2>&1 || true
  docker compose rm -f frontend backend >/dev/null 2>&1 || true
}

kill_port_listener() {
  local port="$1"
  mapfile -t pids < <(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ ${#pids[@]} -eq 0 ]]; then
    return
  fi

  for pid in "${pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done

  sleep 1

  mapfile -t still_up < <(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ ${#still_up[@]} -gt 0 ]]; then
    for pid in "${still_up[@]}"; do
      kill -9 "$pid" >/dev/null 2>&1 || true
    done
  fi
}

kill_session_if_exists() {
  local session_name="$1"
  if tmux has-session -t "$session_name" 2>/dev/null; then
    tmux kill-session -t "$session_name"
  fi
}

start_app_session() {
  local backend_cmd="$1"
  local frontend_cmd="$2"
  local shared_env="$3"

  tmux new-session -d -s "$APP_SESSION" -n app \
    "cd '$ROOT_DIR' && ${shared_env} ${backend_cmd}"

  tmux split-window -h -t "${APP_SESSION}:app" \
    "cd '$ROOT_DIR' && ${shared_env} ${frontend_cmd}"

  tmux select-layout -t "${APP_SESSION}:app" tiled
  tmux select-pane -t "${APP_SESSION}:app.0" -T "backend"
  tmux select-pane -t "${APP_SESSION}:app.1" -T "frontend"
}

configure_tmux
if [[ "$MODE" != "local" ]]; then
  stop_compose_services
fi
kill_port_listener "$FRONTEND_PORT"
kill_port_listener "$SELECTED_BACKEND_PORT"
kill_session_if_exists "$LEGACY_BACKEND_SESSION"
kill_session_if_exists "$LEGACY_FRONTEND_SESSION"
kill_session_if_exists "$APP_SESSION"

if [[ "$MODE" == "docker" ]]; then
  BACKEND_PORT="${SELECTED_BACKEND_PORT}" FRONTEND_PORT="${SELECTED_FRONTEND_PORT}" FRONTEND_BIND_IP=0.0.0.0 VITE_PROXY_TARGET=http://backend:8000 make build
  start_app_session "make dev-backend" "make dev-frontend" "BACKEND_PORT=${SELECTED_BACKEND_PORT} FRONTEND_PORT=${SELECTED_FRONTEND_PORT} FRONTEND_BIND_IP=0.0.0.0 VITE_PROXY_TARGET=http://backend:8000"
elif [[ "$MODE" == "docker-fast" ]]; then
  start_app_session "make dev-backend-fast" "make dev-frontend-fast" "BACKEND_PORT=${SELECTED_BACKEND_PORT} FRONTEND_PORT=${SELECTED_FRONTEND_PORT} FRONTEND_BIND_IP=0.0.0.0 VITE_PROXY_TARGET=http://backend:8000"
elif [[ "$MODE" == "local" ]]; then
  make db-up
  start_app_session "make dev-local-backend" "make dev-local-frontend" "BACKEND_PORT=${SELECTED_BACKEND_PORT} FRONTEND_PORT=${SELECTED_FRONTEND_PORT} DB_PORT=$(get_env_value "DB_PORT" "5432") VITE_PROXY_TARGET=http://127.0.0.1:${SELECTED_BACKEND_PORT}"
fi

echo "Started tmux session: ${APP_SESSION}"
echo "  Mode: ${MODE}"
echo "  Pane 0: backend on port ${SELECTED_BACKEND_PORT}"
echo "  Pane 1: frontend on port ${SELECTED_FRONTEND_PORT}"
echo "  Frontend URL: http://harmony.local:${SELECTED_FRONTEND_PORT}/"
echo
echo "Attach with:"
echo "  tmux attach -t ${APP_SESSION}"
