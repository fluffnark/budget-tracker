.PHONY: dev dev-backend dev-frontend dev-backend-fast dev-frontend-fast dev-local-backend dev-local-frontend db-up build stop test lint cleanup-accounts tailscale-service

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
