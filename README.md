# Budget Tracker (Local-Only, Single User)

A local-first budget tracking app with SimpleFIN ingestion, transfer deconfliction, reports, analytics charts, and privacy-aware LLM export.

## Stack
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, APScheduler
- DB: PostgreSQL 16
- Frontend: Vite, React, TypeScript
- Charts: Recharts, d3-sankey
- Tooling: Ruff, Black, Pytest, ESLint, Prettier, Vitest

## Quick Start
1. Create env file:
   - `cp .env.example .env`
2. Generate a Fernet-compatible master key (32-byte urlsafe base64):
   - `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
   - Put that value into `MASTER_KEY` in `.env`.
3. Optional: override local ports in `.env` if conflicts exist:
   - `DB_PORT`, `BACKEND_PORT`, `FRONTEND_PORT`, `VITE_API_BASE`
4. Start the app with the repo tmux launcher:
   - `./start_app.sh`
   - Fast local restart: `./start_app.sh --docker-fast`
5. Open the app:
   - Frontend: `http://127.0.0.1:5173/budget/`
   - Backend health: `http://127.0.0.1:58010/api/health`
6. First run only:
   - Open `/budget/login`
   - Create the single owner account for this machine
   - Passwords are stored with Argon2 hashes
7. Connect SimpleFIN:
   - Open `Settings`
   - Paste your SimpleFIN setup token or access URL
   - Click `Claim token`
   - Click `Sync now` or `Backfill history`
8. Stop the app when needed:
   - `./stop_app.sh`

## Startup (Shared Host / tmux)
Use the included launcher for `http://harmony.local:5173/`:

1. Start in a named tmux session with 2 panes:
   - `./start_app.sh` (docker with rebuild)
   - `./start_app.sh --docker-fast` (docker without rebuild)
   - `./start_app.sh --local` (lightweight host-run backend/frontend; docker db only)
2. Attach:
   - `tmux attach -t budget-app`
3. Pane layout:
   - Left pane: backend (`docker compose up --build backend`)
   - Right pane: frontend (`docker compose up --build --no-deps frontend`)
4. Stop:
   - `tmux kill-session -t budget-app`
   - Or run `./stop_app.sh` (also available as `make stop`)

Notes:
- `start_app.sh` enables tmux mouse support and vi keys.
- `start_app.sh --local` is the lightest startup path and uses `make dev-local-backend` / `make dev-local-frontend`.
- If `8000` is already in use, backend is auto-mapped to `58010` (or another fallback).
- Frontend is exposed on `0.0.0.0:5173` for `harmony.local`.

## Nginx Prefix Routing (`/budget`)
To host without colliding with other local services, publish this app only under `harmony.local/budget`.

1. Set frontend path env in `.env`:
   - `VITE_BASE_PATH=/budget/`
   - `VITE_ROUTER_BASENAME=/budget`
   - `VITE_API_BASE=/budget`
2. Restart frontend/backend (`./start_app.sh` or local dev commands).
3. Add Nginx locations (more specific API rule first):

```nginx
location = /budget {
  return 301 /budget/;
}

location /budget/api/ {
  proxy_pass http://127.0.0.1:8000/api/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location /budget/ {
  proxy_pass http://127.0.0.1:5173/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

## Login
- Go to `/budget/login`.
- First run shows `First-Time Setup` and creates the single local owner account.
- After setup, the same screen switches to standard sign-in for that owner account.
- Use `Settings` to change the password later.

## Mock Mode (SimpleFIN)
- Set `SIMPLEFIN_MOCK=1` in `.env`.
- Fixture source: `backend/fixtures/simplefin_accounts.json`.
- Optional fixture regeneration: `python backend/scripts/generate_simplefin_fixture.py`.
- For real account sync, keep `SIMPLEFIN_MOCK=0` and restart app.

## Add Your SimpleFIN Account
1. Disable mock mode in `.env`:
   - `SIMPLEFIN_MOCK=0`
2. Restart app:
   - `./start_app.sh`
3. In SimpleFIN Bridge, open your institution and copy the one-time setup token or returned access URL.
4. Add it in the UI:
   - Open `/settings`
   - Paste setup token
   - Click `Claim token`
   - Click `Sync now`
   - Use `Backfill history` for the initial import if you want the fullest available history

Notes:
- This app is local-only and single-user.
- The SimpleFIN access URL is encrypted at rest.
- Do not commit `.env`, `secrets.json`, database dumps, or backups.

## Verification Commands
- `make lint`
- `make test`
- `./start_app.sh`

If you previously ran mock/manual data and want SimpleFIN-only accounts:
- Run `make cleanup-accounts` to deactivate non-SimpleFIN and mock-fixture accounts.

## Run a Sync
- Settings page: click `Sync now`.
- API: `POST /api/sync/run`.
- Sync now deactivates stale SimpleFIN accounts that are not returned by the latest `/accounts` payload (prevents old mock-only accounts from lingering as active).

## Test Database Safety
- Tests are isolated from your live app database.
- Pytest uses `TEST_DATABASE_URL` if set, otherwise derives `<DATABASE_URL>_test`.
- Safety guard: test DB name must end with `_test`; unsafe DB names are rejected.
- Recommended `.env` values:
  - `DATABASE_URL=postgresql+psycopg://budget:budget@db:5432/budget`
  - `TEST_DATABASE_URL=postgresql+psycopg://budget:budget@db:5432/budget_test`

## Categorization Studio
- Open `/categorize` for side-by-side categorization:
  - Sectioned layout with left jump menu
  - Transactions table + live summary/pie/Sankey sections
- `/transactions` now redirects to `/categorize` to keep one primary workflow.
- Category edits are saved immediately (optimistic row update + rollback on failure).
- Filters are persisted to URL + local storage for low-click revisits and shareable state.

### Enable Auto-categorize
1. Set in `.env`:
   - `AUTO_CATEGORIZATION=1`
2. Restart app.
3. Open `/categorize` and click `Auto-categorize`.
4. Review suggestions, then apply selected rows above your confidence threshold.

API endpoints (feature-flagged by `AUTO_CATEGORIZATION`):
- `POST /api/categorization/suggest`
- `POST /api/categorization/apply`

## Auto-Categorization Verification
Use this quick manual check in mock mode:

1. Enable flags in `.env`:
   - `SIMPLEFIN_MOCK=1`
   - `AUTO_CATEGORIZATION=1`
2. Rebuild/start:
   - `make build`
   - `./start_app.sh --docker-fast` (or `--local`)
3. In UI:
   - Open `/categorize`
   - Select a period with known mock transactions
   - Click `Auto-categorize`
   - Confirm review modal shows reason + confidence
   - Click `Apply all above threshold` then `Apply selected`
4. Validate:
   - Success toast shows applied/skipped counts
   - Uncategorized KPI decreases
   - Edited rows reflect categories without page reload

## Toggle Pending
- Transactions page: `Include pending` checkbox.
- Reports and Analytics pages also include pending toggles.

## Export for LLM
- Open `/export`.
- Click `Export for LLM`, then either:
  - `Copy to clipboard`
  - `Download JSON`
- Privacy scrub is enabled by default.

## Theme Tokens
- Theme variables live in `frontend/src/styles/theme.css`.
- Core palette tokens: `--bg`, `--fg`, `--text-muted`, `--text-subtle`, and accent tokens (`--accent-rose`, `--accent-clay`, `--accent-terracotta`, `--accent-sand`, `--accent-brown`, `--accent-mauve`).
- UI tokens are derived from the palette (`--card-bg`, `--border`, `--input-bg`, `--hover-bg`, button/link/focus tokens).
- Chart series tokens are `--series-1` through `--series-5` and are mapped to the accent palette.
- To retheme the app globally, update token values in `frontend/src/styles/theme.css`; components and charts read from these variables.
- Theme mode is controlled in `/settings` with `System`, `Dark`, or `Light`. Selection is saved in local storage (`bt_theme_mode`).

## Security Notes
- `.env` and `secrets.json` are gitignored.
- SimpleFIN Access URL is encrypted at rest using `MASTER_KEY`.
- Request logging uses secret scrubbing middleware.
- App binds to `127.0.0.1` via Docker port mapping.
- Frontend proxies `/api` requests through Vite to avoid cross-origin browser/extension interference.

## Troubleshooting
- `ERR_BLOCKED_BY_CLIENT` on login:
  - Usually caused by browser extensions blocking direct `127.0.0.1` API calls.
  - This app now uses same-origin `/api` proxying from Vite.
  - Hard refresh the page after restart (`Ctrl+Shift+R`).
  - If needed, disable the blocking extension for `harmony.local`.
- `Blocked request. This host ("harmony.local") is not allowed`:
  - Fixed by `server.allowedHosts` in `frontend/vite.config.ts`.
  - Restart frontend after config changes.
