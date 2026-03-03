# Architecture

## Overview
Local-only, single-user budget tracker with a FastAPI backend, React frontend, and PostgreSQL storage. SimpleFIN ingestion runs on a daily schedule via APScheduler within the backend process. The app supports transfer deconfliction, reporting, analytics charts, and privacy-scrubbed LLM export.

## Components
- **Frontend (Vite + React + TS)**: SPA with pages for dashboard, accounts, transactions, reports, analytics, rules, export, and settings.
- **Backend (FastAPI)**: REST API for auth, ingestion, normalization, reporting, analytics, and export.
- **Database (PostgreSQL 16)**: System of record for accounts, balances, transactions, rules, and audit log.
- **Job Runner (APScheduler)**: Daily sync job; manual sync endpoint for on-demand runs.

## Data Flow
1. **SimpleFIN Setup**: User enters a setup token in Settings. Backend claims it and stores the access URL encrypted at rest.
2. **Daily Sync**: Scheduler triggers `/accounts` pull. Data is normalized, deduped, and persisted.
3. **Normalization + Reconciliation**: Descriptions normalized; pending transactions reconciled with posted versions to prevent duplicates.
4. **Transfer Detection**: Candidate inflow/outflow pairs are scored; high-confidence pairs are auto-confirmed.
5. **Reporting/Analytics**: Aggregations derived from transactions, respecting pending/transfer toggles.
6. **LLM Export**: Generates a scrubbed payload with prompt template.

## Security Notes
- **Secrets**: SimpleFIN access URL encrypted using `MASTER_KEY` (Fernet). `.env` is gitignored.
- **Logging**: Log scrubber middleware removes credentials and authorization details.
- **Local-only**: Binds to `127.0.0.1` on host; remote access via SSH tunnel or tailnet.

## Key Tables
- `owner`, `connections`, `institutions`, `accounts`, `balance_snapshots`, `transactions`, `merchants`, `categories`, `classification_rules`, `transfers`, `audit_log`.

## Sync Strategy
- Initial full fetch (bounded by provider limits).
- Incremental sync overlaps last 7 days to catch late changes.
- Idempotent ingestion enforced via unique constraints and ingestion hash.
