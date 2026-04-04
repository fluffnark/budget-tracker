# Repository Guidelines

## Project Summary
Local-only budget tracker with SimpleFIN ingestion, transfer deconfliction, reporting/analytics, and privacy-aware LLM export.

## Scope (v1)
- Unified local DB of accounts, balances, transactions.
- SimpleFIN Bridge ingestion with quota-aware daily sync.
- Spending & trend tracking (Mode A), no zero-based/envelope budgeting.
- Transfer detection with auto-confirm at high confidence.
- Reporting: weekly/monthly views, deltas, utilities breakdowns.
- Analytics studio: Sankey flows, pie charts, projections with tunable knobs.
- Export: LLM-ready, privacy-scrubbed dataset + prompt template.

## Constraints
- Local-only single-user app; no multi-tenant concerns.
- Never store bank passwords; only SimpleFIN access URL (encrypted at rest).
- SimpleFIN cadence: typically ~daily; history may be capped (~90 days).
- Quota-aware: design for daily sync, not polling.

## Architecture
- Web UI SPA: dashboard, transactions, reports, analytics, settings, export.
- Backend API: auth, ingestion, normalization, transfers, reporting, export.
- DB: PostgreSQL preferred; SQLite acceptable for simple setups.
- Job runner: scheduled sync, classification, cached aggregates.
- Local deployment: Docker Compose (app + Postgres). Bind 127.0.0.1 by default.

## Data Sources (v1)
- SimpleFIN accounts: Citi (CC), Sandia Laboratory FCU (checking/savings).
- Balances-only/manual: Fidelity 401k, Wealthfront HYSA, Vanguard Roth IRA, Bank of Albuquerque mortgage.
- Source types: `simplefin`, `manual`, `import` (CSV/QFX, future).

## SimpleFIN Integration
- Setup: claim setup token to get Access URL (contains Basic Auth creds).
- Pull: `GET {ACCESS_URL}/accounts` with `pending=1`, optional `start-date`, `end-date`, `balances-only`, `account`.
- Schedule: daily sync; optional manual “Sync now” with quota warning.
- Track connection status: `ok`, `needs_attention`, `revoked`, `rate_limited`, `error`.
- Store per-connection and per-account `last_sync_at`.

## Core Data Model (Postgres)
Entities:
- `owner`, `connections`, `institutions`, `accounts`, `balance_snapshots`, `transactions`, `merchants`, `categories`, `classification_rules`, `transfers`, `audit_log`.
Key constraints/indexes:
- Unique: `(account_id, provider_txn_id)` when provider id present; `(account_id, ingestion_hash)` for fallback idempotency.
- Indexes: `transactions(account_id, posted_at desc)`, `transactions(category_id, posted_at)`, `transactions(is_pending, posted_at)`, `balance_snapshots(account_id, captured_at desc)`.

## Ingestion & Normalization
- Pull `/accounts?pending=1&start-date=...`.
- Upsert accounts; insert balance snapshots; upsert transactions.
- Normalize descriptions (trim/collapse/remove noise).
- `ingestion_hash = hash(account + posted_at + amount + description_norm + provider_txn_id?)`.
- Pending reconciliation: match posted txn by fingerprint `(account, amount, description_norm, near-date)`.
- Backfill: initial max history; incremental overlap 7 days to catch edits.

## Transfers (Auto-Confirm High Confidence)
- Match outflow/inflow pairs with amount, date window (±2 days), currency, and ownership.
- Confidence scoring: amount match required; add date proximity, transfer keywords, known routes; apply penalties.
- Auto-confirm if confidence >= 0.85; otherwise propose for review.
- Paired transfers excluded from spend/income totals; included in balance timelines and Sankey flows.

## Categorization (Mode A)
- Spending by category with manual override precedence.
- Rules engine for classification; default is `Uncategorized: Needs Review`.
- Utilities special mapping; utilities report with monthly totals, rolling averages, YoY.

## Reporting & Analytics
- Filters: date range, accounts, include pending (default ON), include transfers (default OFF for spend/income).
- Reports: weekly, monthly, yearly views + deltas; utilities breakdowns.
- Analytics studio: Sankey (3 modes), pie charts, projections.
- Projections use last 6 months baseline with user knobs (inflation, APR, extra payments).

## Export (LLM-Ready)
- Outputs: `transactions.jsonl` (or array), `categories.json`, `merchants.json` (opt), `summary.json`, prompt template.
- Fields: date, amount, currency, description_norm, merchant_canonical, account_type, category, is_pending, is_transfer, notes.
- Privacy scrub default ON: remove account names, raw descriptions, SimpleFIN URLs/creds; hash merchants; optional amount rounding.
- Prompt templates versioned for reproducibility.

## Security
- `.env` gitignored. Encrypt access URL at rest.
- Never log tokens/access URLs/authorization headers.
- Password auth (argon2/bcrypt). Session cookies httpOnly, SameSite=Lax, secure if https.
- Bind 127.0.0.1 by default; recommend SSH tunnel/tailnet for remote.
- Encrypted DB backups with restore procedure.

## Performance Targets
- Dashboard < 1s with cached aggregates.
- Transactions table paginated with server-side filtering.
- Sankey uses pre-aggregated edges per selected period.

## Agent Workflow Notes
- The frontend is commonly run in tmux session `budget-app`, usually pane `budget-app:0.1`.
- The backend is commonly run in tmux session `budget-app`, usually pane `budget-app:0.0`.
- To verify the live frontend, do not rely on code-on-disk alone. Check tmux pane output and hit Vite directly at `http://127.0.0.1:5173/budget/`.
- Useful live checks:
  - `tmux list-panes -a -F '#S:#I.#P #{pane_current_command} #{pane_current_path}'`
  - `tmux capture-pane -t budget-app:0.1 -p | tail -n 40`
  - `curl -I http://127.0.0.1:5173/budget/`
  - `curl 'http://127.0.0.1:5173/budget/src/...?...'` to confirm the running Vite module contains a change.
- If the frontend pane disappears after `C-c`, recreate it with:
  - `tmux split-window -h -t budget-app:0 'cd /home/harmony/repos/budget-tracker && make dev-frontend'`
- After meaningful frontend changes, rebuild with `cd frontend && npm run build` before restarting tmux.

## UI Implementation Notes
- Prefer verifying the currently served module over assuming Vite HMR picked up a change.
- For analytics and dashboard period navigation, the repo now uses explicit selected week/month/year state rather than always binding to the current period. Preserve that pattern when extending timeline controls.
- The Categorization Studio now surfaces the most important metrics inline at the top of the Transactions section. Keep primary summary stats visible without requiring expansion.
- The category selector in transaction tables is sensitive to clipping and portal behavior. Avoid reintroducing hover flyout columns. The safer pattern in this repo is a portalized single-column tree with inline expand/collapse rows.
- If a dropdown menu is rendered through a portal, outside-click detection must treat both the trigger container and the portal menu itself as inside targets.

## Search and LLM Notes
- Transaction search supports fuzzy terms and quoted exact phrases. Preserve both behaviors when changing search logic.
- The Categorization Studio supports distinct LLM prompt modes for `high_precision` and `high_coverage`. Do not collapse them back into one mode.
- LLM validation should report true counts, not truncated display lists. When adjusting validation/preflight logic, keep count fields authoritative.

## Tailscale Notes
- This repo includes a `--tailscale` startup mode and `scripts/configure_tailscale_service.sh`.
- The intended split is:
  - normal local/shared-host mode: app served under `/budget`
  - tailscale mode: app served at `/`
- Tailscale Services require a tagged node and host approval in the Tailscale admin console. Local repo changes alone do not publish the service hostname.

## Testing & Acceptance Criteria
- Idempotent sync (no new rows on double run).
- Pending reconciliation prevents duplicates.
- 7-day overlap doesn’t duplicate.
- Transfer pairing is exclusive; credit card payments treated as transfers when both sides visible.
- Pending toggle affects totals only, not stored data.
- Export scrub removes secrets and account names.

## Future Options (Not v1)
- Investments: positions table, holdings import, contribution tracking.
- Smarter classification (local ML).
- Optional in-app LLM assist (export-only for now).
- Multiple SimpleFIN connections supported within single-user mode.
