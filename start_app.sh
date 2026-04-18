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
    --tailscale)
      MODE="tailscale"
      ;;
    *)
      echo "Unknown mode: $1"
      echo "Usage: ./start_app.sh [--docker|--docker-fast|--local|--tailscale]"
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
BACKEND_BIND_IP="$(get_env_value "BACKEND_BIND_IP" "127.0.0.1")"
FRONTEND_BIND_IP="$(get_env_value "FRONTEND_BIND_IP" "0.0.0.0")"

port_in_use() {
  local port="$1"
  lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

pick_available_port() {
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

SELECTED_BACKEND_PORT="$(pick_available_port "$BACKEND_PORT" 58010 18000 28000)"
SELECTED_FRONTEND_PORT="$(pick_available_port "$FRONTEND_PORT" 5173 4173 6173)"

configure_tmux() {
  tmux set-option -g mouse on
  tmux set-option -g status-keys vi
  tmux set-window-option -g mode-keys vi
  tmux set-option -g history-limit 100000
  tmux set-option -g renumber-windows on
}

kill_session_if_exists() {
  local session_name="$1"
  if tmux has-session -t "$session_name" 2>/dev/null; then
    tmux kill-session -t "$session_name"
  fi
}

start_log_session() {
  local backend_log_cmd="$1"
  local frontend_log_cmd="$2"
  tmux new-session -d -s "$APP_SESSION" -n logs \
    "cd '$ROOT_DIR' && ${backend_log_cmd}"
  configure_tmux
  tmux split-window -h -t "${APP_SESSION}:logs" \
    "cd '$ROOT_DIR' && ${frontend_log_cmd}"
  tmux select-layout -t "${APP_SESSION}:logs" tiled
  tmux select-pane -t "${APP_SESSION}:logs.0" -T "backend logs"
  tmux select-pane -t "${APP_SESSION}:logs.1" -T "frontend logs"
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-30}"
  local delay="${3:-1}"
  local i
  for i in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

kill_session_if_exists "$LEGACY_BACKEND_SESSION"
kill_session_if_exists "$LEGACY_FRONTEND_SESSION"
kill_session_if_exists "$APP_SESSION"

if [[ "$MODE" == "docker" ]]; then
  BACKEND_PORT="${SELECTED_BACKEND_PORT}" FRONTEND_PORT="${SELECTED_FRONTEND_PORT}" BACKEND_BIND_IP="${BACKEND_BIND_IP}" FRONTEND_BIND_IP="${FRONTEND_BIND_IP}" VITE_PROXY_TARGET=http://backend:8000 make app-up
  start_log_session "make logs-backend" "make logs-frontend"
elif [[ "$MODE" == "docker-fast" ]]; then
  BACKEND_PORT="${SELECTED_BACKEND_PORT}" FRONTEND_PORT="${SELECTED_FRONTEND_PORT}" BACKEND_BIND_IP="${BACKEND_BIND_IP}" FRONTEND_BIND_IP="${FRONTEND_BIND_IP}" VITE_PROXY_TARGET=http://backend:8000 make app-up-fast
  start_log_session "make logs-backend" "make logs-frontend"
elif [[ "$MODE" == "local" ]]; then
  make db-up
  tmux new-session -d -s "$APP_SESSION" -n app \
    "cd '$ROOT_DIR' && BACKEND_PORT=${SELECTED_BACKEND_PORT} FRONTEND_PORT=${SELECTED_FRONTEND_PORT} DB_PORT=$(get_env_value "DB_PORT" "5432") VITE_PROXY_TARGET=http://127.0.0.1:${SELECTED_BACKEND_PORT} make dev-local-backend"
  configure_tmux
  tmux split-window -h -t "${APP_SESSION}:app" \
    "cd '$ROOT_DIR' && BACKEND_PORT=${SELECTED_BACKEND_PORT} FRONTEND_PORT=${SELECTED_FRONTEND_PORT} VITE_PROXY_TARGET=http://127.0.0.1:${SELECTED_BACKEND_PORT} make dev-local-frontend"
  tmux select-layout -t "${APP_SESSION}:app" tiled
  tmux select-pane -t "${APP_SESSION}:app.0" -T "backend"
  tmux select-pane -t "${APP_SESSION}:app.1" -T "frontend"
elif [[ "$MODE" == "tailscale" ]]; then
  BACKEND_PORT="${SELECTED_BACKEND_PORT}" FRONTEND_PORT="${SELECTED_FRONTEND_PORT}" BACKEND_BIND_IP=127.0.0.1 FRONTEND_BIND_IP=127.0.0.1 VITE_PROXY_TARGET=http://backend:8000 VITE_BASE_PATH=/ VITE_ROUTER_BASENAME= VITE_ALLOWED_HOSTS=budget.great-kettle.ts.net,127.0.0.1,localhost make app-up
  start_log_session "make logs-backend" "make logs-frontend"
fi

if [[ "$MODE" != "local" ]]; then
  FRONTEND_HEALTH_PATH="/budget/"
  if [[ "$MODE" == "tailscale" ]]; then
    FRONTEND_HEALTH_PATH="/"
  fi
  wait_for_http "http://127.0.0.1:${SELECTED_FRONTEND_PORT}${FRONTEND_HEALTH_PATH}" 60 1 || true
fi

echo "Started tmux session: ${APP_SESSION}"
echo "  Mode: ${MODE}"
echo "  Pane 0: backend logs"
echo "  Pane 1: frontend logs"
if [[ "$MODE" == "tailscale" ]]; then
  echo "  Frontend URL: http://127.0.0.1:${SELECTED_FRONTEND_PORT}/"
  echo "  Tailscale Service URL: https://budget.great-kettle.ts.net/ (after advertisement + approval)"
else
  echo "  Frontend URL: http://harmony.local:${SELECTED_FRONTEND_PORT}/budget/"
fi
echo
echo "Attach with:"
echo "  tmux attach -t ${APP_SESSION}"
