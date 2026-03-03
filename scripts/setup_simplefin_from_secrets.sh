#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SECRETS_FILE="${SECRETS_FILE:-$ROOT_DIR/secrets.json}"
SECRETS_KEY="${SECRETS_KEY:-simplefin_token}"
EMAIL="${BUDGET_EMAIL:-owner@example.com}"
PASSWORD="${BUDGET_PASSWORD:-test-password}"

port_is_healthy() {
  local port="$1"
  curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1
}

pick_backend_port() {
  local -a candidates=()
  if [[ -n "${BACKEND_PORT:-}" ]]; then
    candidates+=("$BACKEND_PORT")
  fi

  if [[ -f .env ]]; then
    local env_port
    env_port="$(grep -E '^BACKEND_PORT=' .env | tail -n1 | cut -d'=' -f2- || true)"
    if [[ -n "$env_port" ]]; then
      candidates+=("$env_port")
    fi
  fi

  candidates+=(8000 58010 18000 28000)

  local p
  for p in "${candidates[@]}"; do
    if port_is_healthy "$p"; then
      echo "$p"
      return
    fi
  done

  echo ""
}

BACKEND_PORT_PICKED="$(pick_backend_port)"
if [[ -z "$BACKEND_PORT_PICKED" ]]; then
  echo "No healthy backend found on localhost. Start app first (./start_app.sh)." >&2
  exit 1
fi

API_BASE="${API_BASE:-http://127.0.0.1:${BACKEND_PORT_PICKED}}"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing secrets file: $SECRETS_FILE" >&2
  exit 1
fi

SETUP_TOKEN="$({
  SECRETS_FILE="$SECRETS_FILE" SECRETS_KEY="$SECRETS_KEY" python3 - <<'PY'
import json
import os
import sys

path = os.environ['SECRETS_FILE']
key = os.environ['SECRETS_KEY']

with open(path, 'r', encoding='utf-8') as f:
    payload = json.load(f)

value = payload.get(key)
if not value:
    sys.exit(2)
print(value)
PY
} 2>/dev/null)" || {
  echo "Could not read setup token key '$SECRETS_KEY' from $SECRETS_FILE" >&2
  exit 1
}

COOKIE_JAR="$(mktemp)"
cleanup() {
  rm -f "$COOKIE_JAR"
  rm -f /tmp/budget_claim_resp.json
}
trap cleanup EXIT

login_payload="$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")"

curl -fsS -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "$login_payload" \
  "$API_BASE/api/auth/login" >/dev/null

claim_payload="$(SETUP_TOKEN="$SETUP_TOKEN" python3 - <<'PY'
import json
import os
print(json.dumps({"setup_token": os.environ["SETUP_TOKEN"]}))
PY
)"

claim_http="$(curl -sS -o /tmp/budget_claim_resp.json -w '%{http_code}' -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "$claim_payload" \
  "$API_BASE/api/simplefin/claim")"

if [[ "$claim_http" != "200" ]]; then
  claim_detail="$(cat /tmp/budget_claim_resp.json 2>/dev/null || true)"
  if [[ "$claim_http" == "400" && "$claim_detail" == *"claim failed: 403"* ]]; then
    echo "Setup token already claimed; continuing with existing stored connection."
  else
    echo "SimpleFIN claim failed (HTTP $claim_http)." >&2
    echo "$claim_detail" >&2
    exit 1
  fi
fi

curl -fsS -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d '{"balances_only": false}' \
  "$API_BASE/api/sync/run" >/dev/null

echo "SimpleFIN claimed and sync completed via $API_BASE"
echo "Login email used: $EMAIL"
