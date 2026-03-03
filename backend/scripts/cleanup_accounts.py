from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Account

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "simplefin_accounts.json"


def load_fixture_ids() -> set[str]:
    if not FIXTURE_PATH.exists():
        return set()
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    ids: set[str] = set()
    for account in payload.get("accounts", []):
        account_id = account.get("id")
        if account_id:
            ids.add(str(account_id))
    return ids


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Deactivate local fake/mock/non-SimpleFIN accounts without deleting historical rows."
        )
    )
    parser.add_argument("--apply", action="store_true", help="persist changes")
    parser.add_argument(
        "--simplefin-only",
        action="store_true",
        help="deactivate non-simplefin accounts",
    )
    parser.add_argument(
        "--deactivate-fixture-accounts",
        action="store_true",
        help="deactivate accounts whose provider_account_id appears in mock fixture",
    )
    args = parser.parse_args()

    fixture_ids = load_fixture_ids() if args.deactivate_fixture_accounts else set()

    session = SessionLocal()
    try:
        accounts = session.execute(select(Account)).scalars().all()
        to_deactivate: list[Account] = []
        for account in accounts:
            if not account.is_active:
                continue
            if args.simplefin_only and account.source_type != "simplefin":
                to_deactivate.append(account)
                continue
            if (
                args.deactivate_fixture_accounts
                and account.source_type == "simplefin"
                and account.provider_account_id in fixture_ids
            ):
                to_deactivate.append(account)

        print(f"accounts_total={len(accounts)}")
        print(f"accounts_to_deactivate={len(to_deactivate)}")
        for account in to_deactivate:
            print(
                f"- {account.id} | {account.name} | source={account.source_type} | provider={account.provider_account_id}"
            )

        if args.apply:
            for account in to_deactivate:
                account.is_active = False
            session.commit()
            print("applied=1")
        else:
            session.rollback()
            print("applied=0 (dry-run)")
    finally:
        session.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
