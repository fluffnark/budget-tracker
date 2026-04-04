from __future__ import annotations

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Category, ClassificationRule, Transaction


def category_id_by_name(db) -> dict[str, int]:
    categories = list(db.execute(select(Category)).scalars())
    return {category.name: category.id for category in categories}


def main() -> None:
    db = SessionLocal()
    try:
        category_ids = category_id_by_name(db)
        dining_id = category_ids["Dining"]
        transfer_id = category_ids["Transfers/Internal"]

        coffee_markers = [
            "COFFEE",
            "CASTLE COFFEE",
            "SLOW BURN COFFEE",
            "LA LUZ COFFEE",
            "PICACHO COFFEE",
            "HEATWAVE COFFEE",
            "CIPS COFFEE",
        ]
        transfer_markers = [
            "BANKING WITHDRAWAL TRANSFER TO",
            "WITHDRAWAL COMPANY: CITI AUTOPAY ENTRY:",
            "WITHDRAWAL COMPANY: TARGET CRD ENTRY:",
            "WITHDRAWAL COMPANY: VANGUARD BUY ENTRY:",
            "VANGUARD TARGET RETIREMENT",
            "VANGUARD FEDERAL MONEY MARKET",
            "PAYMENT, THANK YOU",
            "ONLINE PMT",
            "WEALTHFRONT",
        ]

        coffee_updates = 0
        transfer_updates = 0
        retirement_updates = 0

        desired_rules = [
            (18, "contains", "COFFEE", dining_id),
            (19, "contains", "BANKING WITHDRAWAL TRANSFER TO", transfer_id),
            (20, "contains", "PAYMENT, THANK YOU", transfer_id),
            (21, "contains", "ONLINE PMT", transfer_id),
        ]
        rules_created = 0
        for priority, match_type, pattern, category_id in desired_rules:
            existing = db.execute(
                select(ClassificationRule).where(
                    ClassificationRule.match_type == match_type,
                    ClassificationRule.pattern == pattern,
                    ClassificationRule.category_id == category_id,
                )
            ).scalar_one_or_none()
            if existing is None:
                db.add(
                    ClassificationRule(
                        priority=priority,
                        match_type=match_type,
                        pattern=pattern,
                        category_id=category_id,
                        merchant_override_id=None,
                        is_active=True,
                    )
                )
                rules_created += 1

        txns = list(db.execute(select(Transaction)).scalars())
        for txn in txns:
            desc = (txn.description_norm or "").upper()
            if not desc:
                continue

            if any(marker in desc for marker in coffee_markers):
                if txn.category_id != dining_id and not txn.manual_category_override:
                    txn.category_id = dining_id
                    coffee_updates += 1
                continue

            if any(marker in desc for marker in transfer_markers):
                if txn.category_id != transfer_id:
                    txn.category_id = transfer_id
                    transfer_updates += 1
                continue

            if desc == "RETIREMENT" and txn.category_id == category_ids["Bank Fees"]:
                txn.category_id = transfer_id
                retirement_updates += 1

        db.commit()
        print(
            {
                "coffee_updates": coffee_updates,
                "transfer_updates": transfer_updates,
                "retirement_updates": retirement_updates,
                "rules_created": rules_created,
            }
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
