#!/usr/bin/env python3
"""Generate a deterministic sample SimpleFIN /accounts payload for local mock mode."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / "fixtures" / "simplefin_accounts.json"


def main() -> None:
    now = datetime.now(UTC).replace(hour=12, minute=0, second=0, microsecond=0)
    accounts = [
        {
            "id": "slfcu-checking-001",
            "name": "SLFCU Checking",
            "type": "checking",
            "currency": "USD",
            "institution": {"name": "Sandia Laboratory Federal Credit Union"},
            "balance": {
                "current": 3200.12,
                "available": 3100.12,
                "as_of": now.isoformat().replace("+00:00", "Z"),
            },
            "transactions": [
                {
                    "id": "chk-a",
                    "posted": (now - timedelta(days=2)).date().isoformat(),
                    "amount": -145.34,
                    "description": "UTILITY ELECTRIC PAYMENT",
                    "pending": False,
                },
                {
                    "id": "chk-b",
                    "posted": (now - timedelta(days=1)).date().isoformat(),
                    "amount": -900.00,
                    "description": "CITI CARD PAYMENT",
                    "pending": False,
                },
                {
                    "id": "chk-c",
                    "posted": now.date().isoformat(),
                    "amount": -56.80,
                    "description": "GROCERY STORE",
                    "pending": True,
                },
            ],
        },
        {
            "id": "citi-cc-001",
            "name": "Citi Double Cash",
            "type": "credit",
            "currency": "USD",
            "institution": {"name": "Citi"},
            "balance": {
                "current": -1100.45,
                "available": None,
                "as_of": now.isoformat().replace("+00:00", "Z"),
            },
            "transactions": [
                {
                    "id": "cc-a",
                    "posted": (now - timedelta(days=1)).date().isoformat(),
                    "amount": 900.00,
                    "description": "PAYMENT RECEIVED",
                    "pending": False,
                },
                {
                    "id": "cc-b",
                    "posted": now.date().isoformat(),
                    "amount": -23.10,
                    "description": "COFFEE SHOP",
                    "pending": True,
                },
            ],
        },
    ]

    payload = {"accounts": accounts}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote fixture: {OUTPUT}")


if __name__ == "__main__":
    main()
