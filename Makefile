.PHONY: dev dev-backend dev-frontend dev-backend-fast dev-frontend-fast dev-local-backend dev-local-frontend db-up build app-up app-up-fast app-stop app-restart status logs logs-backend logs-frontend logs-db stop test lint cleanup-accounts tailscale-service service-install service-enable service-start service-stop service-status service-logs

dev:
	docker compose up --build

dev-backend:
	docker compose up --build --force-recreate backend

dev-frontend:
	docker compose up --build --force-recreate --no-deps frontend

dev-backend-fast:
	docker compose up backend

dev-frontend-fast:
	docker compose up --no-deps frontend

db-up:
	docker compose up -d db

dev-local-backend:
	cd backend && DATABASE_URL=$${DATABASE_URL:-postgresql+psycopg://budget:budget@127.0.0.1:$${DB_PORT:-5432}/budget} PYTHONPATH=. ./start.sh

dev-local-frontend:
	cd frontend && VITE_PROXY_TARGET=$${VITE_PROXY_TARGET:-http://127.0.0.1:$${BACKEND_PORT:-8000}} VITE_API_BASE=$${VITE_API_BASE:-} VITE_BASE_PATH=$${VITE_BASE_PATH:-/} VITE_ROUTER_BASENAME=$${VITE_ROUTER_BASENAME:-} npm run dev -- --host 0.0.0.0 --port $${FRONTEND_PORT:-5173}

build:
	docker compose build backend frontend

app-up:
	docker compose up -d --build --force-recreate db backend frontend

app-up-fast:
	docker compose up -d --force-recreate db backend frontend

app-stop:
	docker compose stop frontend backend db

app-restart:
	docker compose up -d --force-recreate db backend frontend

status:
	docker compose ps

logs:
	docker compose logs -f --tail=100 db backend frontend

logs-backend:
	docker compose logs -f --tail=100 backend

logs-frontend:
	docker compose logs -f --tail=100 frontend

logs-db:
	docker compose logs -f --tail=100 db

stop:
	./stop_app.sh

test:
	docker compose run --rm backend pytest
	docker compose run --rm --no-deps frontend npm run test -- --run

lint:
	docker compose run --rm --no-deps backend ruff check .
	docker compose run --rm --no-deps backend black --check .
	docker compose run --rm --no-deps frontend npm run lint
	docker compose run --rm --no-deps frontend npm run format:check

cleanup-accounts:
	docker compose run --rm --no-deps --build backend python scripts/cleanup_accounts.py --simplefin-only --deactivate-fixture-accounts --apply

tailscale-service:
	./scripts/configure_tailscale_service.sh

service-install:
	./scripts/install_systemd_user_service.sh

service-enable:
	systemctl --user enable budget-tracker.service

service-start:
	systemctl --user start budget-tracker.service

service-stop:
	systemctl --user stop budget-tracker.service

service-status:
	systemctl --user status --no-pager budget-tracker.service

service-logs:
	journalctl --user -u budget-tracker.service -n 200 -f
