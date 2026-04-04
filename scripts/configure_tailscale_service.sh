#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE_NAME="${TAILSCALE_SERVICE_NAME:-svc:budget}"
SERVICE_HOST="${TAILSCALE_SERVICE_HOST:-budget.great-kettle.ts.net}"
HTTPS_PORT="${TAILSCALE_SERVICE_PORT:-443}"

get_env_value() {
  local key="$1"
  local fallback="$2"
  if [[ -f .env ]] && grep -q "^${key}=" .env; then
    grep "^${key}=" .env | tail -n1 | cut -d'=' -f2-
  else
    echo "$fallback"
  fi
}

FRONTEND_PORT="${FRONTEND_PORT:-$(get_env_value "FRONTEND_PORT" "5173")}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI not found."
  exit 1
fi

echo "Advertising ${SERVICE_NAME} on https://${SERVICE_HOST}/ -> http://127.0.0.1:${FRONTEND_PORT}"
tailscale serve --service="${SERVICE_NAME}" --https="${HTTPS_PORT}" "127.0.0.1:${FRONTEND_PORT}"

echo
tailscale serve status

cat <<EOF

If this is the first time you are using Tailscale Services for this app:
1. In the Tailscale admin console, define the service as '${SERVICE_NAME#svc:}' with endpoint 'tcp:${HTTPS_PORT}'.
2. Make sure this host uses a tag-based Tailscale identity.
3. Approve this host advertisement in the Tailscale Services UI.

Start the app in service mode before using the URL:
  ./start_app.sh --tailscale
EOF
