# API

Base path: `/api`

## Health
- `GET /health`

## Auth
- `POST /auth/login`
  - Body: `{ "email": "...", "password": "..." }`
- `POST /auth/logout`

## Accounts
- `GET /accounts`

## Transactions
- `GET /transactions?start=YYYY-MM-DD&end=YYYY-MM-DD&account_id=...&category_id=...&q=...&min_amount=...&max_amount=...&include_pending=1&include_transfers=0`
- `PATCH /transactions/{id}`
  - Body (any): `{ "category_id": 1, "merchant_id": 2, "notes": "...", "is_pending": false }`

## Rules
- `POST /rules`
  - Body: `{ "priority": 10, "match_type": "contains", "pattern": "WALMART", "category_id": 5, "merchant_override_id": null }`
- `GET /rules`
- `DELETE /rules/{id}`

## SimpleFIN
- `POST /simplefin/claim`
  - Body: `{ "setup_token": "..." }`
- `POST /sync/run`

## Reports
- `GET /reports/weekly?start=YYYY-MM-DD&end=YYYY-MM-DD&include_pending=1&include_transfers=0`
- `GET /reports/monthly?year=YYYY&month=MM&include_pending=1&include_transfers=0`
- `GET /reports/yearly?year=YYYY&include_pending=1&include_transfers=0`
- `GET /reports/baseline?months=6`

## Analytics
- `GET /analytics/sankey?start=YYYY-MM-DD&end=YYYY-MM-DD&include_pending=1&include_transfers=0`
- `GET /analytics/projections?utility_inflation_rate=4&general_inflation_rate=3&savings_apr=4.5`

## Export
- `GET /export/llm?start=YYYY-MM-DD&end=YYYY-MM-DD&scrub=1&hash_merchants=1&round_amounts=0`

## Transfers
- `GET /transfers`
- `PATCH /transfers/{id}`
  - Body: `{ \"status\": \"confirmed\" }`

## Settings
- `GET /settings`
- `PATCH /settings`
  - Body: `{ \"sync_daily_hour\": 6, \"sync_daily_minute\": 0, \"scrub_default\": true }`

## Categories
- `GET /categories`
