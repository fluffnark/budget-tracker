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
4. Start app:
   - `make dev`
5. Open:
   - Frontend: `http://127.0.0.1:5173`
   - Backend health: `http://127.0.0.1:8000/api/health`

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

## Verification Commands
- `make lint`
- `make test`
- `make dev`

## Login
- Go to `/login`.
- First successful login creates the single local owner record.
- Subsequent logins must use the same email/password.
- Current local dev owner in this workspace:
  - email: `owner@example.com`
  - password: `test-password`

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
3. Add token via script (reads `secrets.json`, key `simplefin_token`):
   - `./scripts/setup_simplefin_from_secrets.sh`
4. Or add manually in UI:
   - Open `/settings`
   - Paste setup token
   - Click `Claim token`
   - Click `Sync now`

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
