#!/usr/bin/env bash
set -euo pipefail

migrated=0
for i in $(seq 1 30); do
  if alembic upgrade head; then
    migrated=1
    break
  fi

  # If schema already exists without alembic_version (legacy local DB),
  # stamp the initial revision and then apply forward migrations.
  if python - <<'PY'
from sqlalchemy import create_engine, text
from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
with engine.connect() as conn:
    exists = conn.execute(
        text(
            """
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'alembic_version'
            )
            """
        )
    ).scalar_one()
print("missing" if not exists else "present")
raise SystemExit(0 if not exists else 1)
PY
  then
    if alembic stamp 20260222_0001 && alembic upgrade head; then
      migrated=1
      break
    fi
  fi

  echo "Waiting for database... ($i/30)"
  sleep 2
done

if [ "$migrated" -ne 1 ]; then
  echo "Failed to initialize database migrations."
  exit 1
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
