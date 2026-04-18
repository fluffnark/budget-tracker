#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/budget-tracker.service"

mkdir -p "$SERVICE_DIR"

cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=Budget Tracker Docker Compose App
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT_DIR}
Environment=BACKEND_PORT=58010
Environment=BACKEND_BIND_IP=127.0.0.1
Environment=FRONTEND_PORT=5173
Environment=FRONTEND_BIND_IP=0.0.0.0
ExecStart=/usr/bin/make -C ${ROOT_DIR} app-up-fast
ExecStop=/usr/bin/make -C ${ROOT_DIR} app-stop
ExecReload=/usr/bin/make -C ${ROOT_DIR} app-restart
TimeoutStartSec=0

[Install]
WantedBy=default.target
EOF

echo "Installed user service: ${SERVICE_FILE}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
  echo "Reloaded systemd user daemon."
  echo "Next steps:"
  echo "  systemctl --user enable budget-tracker.service"
  echo "  systemctl --user start budget-tracker.service"
  echo "  journalctl --user -u budget-tracker.service -n 200 -f"
else
  echo "systemctl not found; service file installed but not enabled."
fi

echo
echo "For boot-time start before login, enable user lingering once:"
echo "  sudo loginctl enable-linger ${USER}"
