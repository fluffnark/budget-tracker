from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models import Account, ClassificationRule, Transaction


@dataclass
class ProposedRule:
    priority: int
    match_type: str
    pattern: str | None
    category_id: int
    merchant_override_id: int | None
    is_active: bool = True


def _active_rules(db: Session) -> list[ClassificationRule]:
    return list(
        db.execute(
            select(ClassificationRule)
            .where(ClassificationRule.is_active.is_(True))
            .order_by(ClassificationRule.priority.asc(), ClassificationRule.id.asc())
        ).scalars()
    )


def _matches(match_type: str, pattern: str | None, description: str, account_type: str) -> bool:
    pattern = (pattern or "").strip()
    if not pattern and match_type in {"contains", "merchant", "regex"}:
        return False
    if match_type == "contains":
        return pattern.upper() in description
    if match_type == "regex":
        return bool(re.search(pattern, description, flags=re.IGNORECASE))
    if match_type == "merchant":
        return pattern.upper() in description
    if match_type == "account":
        return pattern.upper() in account_type
    return False


def _iter_transactions_with_account(
    db: Session, *, transaction_ids: set[str] | None = None
) -> list[tuple[Transaction, str]]:
    query = (
        select(Transaction, Account.type)
        .join(Account, Account.id == Transaction.account_id)
        .order_by(desc(Transaction.posted_at), Transaction.id.asc())
    )
    if transaction_ids:
        query = query.where(Transaction.id.in_(transaction_ids))
    rows = db.execute(query).all()
    return [(txn, account_type or "") for txn, account_type in rows]


def transaction_matches_rule(txn: Transaction, account_type: str, rule: ProposedRule) -> bool:
    return _matches(rule.match_type, rule.pattern, txn.description_norm, account_type.upper())


def preview_rule_matches(
    db: Session, rule: ProposedRule, *, sample_limit: int = 25
) -> tuple[int, list[str]]:
    if not rule.is_active:
        return 0, []

    match_ids: list[str] = []
    for txn, account_type in _iter_transactions_with_account(db):
        if txn.manual_category_override:
            continue
        if transaction_matches_rule(txn, account_type, rule):
            match_ids.append(txn.id)

    return len(match_ids), match_ids[:sample_limit]


def apply_rules_to_transaction(
    db: Session,
    txn: Transaction,
    *,
    account_type: str | None = None,
    rules: list[ClassificationRule] | None = None,
) -> bool:
    if txn.manual_category_override:
        return False

    active_rules = rules or _active_rules(db)
    acct_type = (account_type or (txn.account.type if txn.account else "") or "").upper()
    desc = txn.description_norm

    for rule in active_rules:
        if _matches(rule.match_type, rule.pattern, desc, acct_type):
            changed = False
            if txn.category_id != rule.category_id:
                txn.category_id = rule.category_id
                changed = True
            if rule.merchant_override_id and txn.merchant_id != rule.merchant_override_id:
                txn.merchant_id = rule.merchant_override_id
                changed = True
            return changed
    return False


def apply_new_rule(
    db: Session, rule: ClassificationRule, *, sample_limit: int = 25
) -> tuple[int, list[str]]:
    if not rule.is_active:
        return 0, []

    proposed = ProposedRule(
        priority=rule.priority,
        match_type=rule.match_type,
        pattern=rule.pattern,
        category_id=rule.category_id,
        merchant_override_id=rule.merchant_override_id,
        is_active=rule.is_active,
    )

    # Run a full pass once to avoid loading all transactions twice.
    candidates: list[tuple[Transaction, str]] = []
    for txn, account_type in _iter_transactions_with_account(db):
        if txn.manual_category_override:
            continue
        if transaction_matches_rule(txn, account_type, proposed):
            candidates.append((txn, account_type))

    active_rules = _active_rules(db)
    changed_ids: list[str] = []
    for txn, account_type in candidates:
        changed = apply_rules_to_transaction(db, txn, account_type=account_type, rules=active_rules)
        if changed:
            changed_ids.append(txn.id)

    return len(changed_ids), changed_ids[:sample_limit]


def looks_like_merchant(description: str) -> bool:
    patterns = ["AMZN", "WALMART", "STORE", "RESTAURANT", "POS", "CARD", "UBER", "TARGET"]
    desc = description.upper()
    return any(token in desc for token in patterns)


def looks_like_transfer(description: str) -> bool:
    desc = description.upper()
    return any(token in desc for token in ["ACH", "TRANSFER", "PAYMENT", "ONLINE PMT", "XFER"])


def looks_like_refund(description: str) -> bool:
    desc = description.upper()
    return any(token in desc for token in ["REFUND", "REVERSAL", "CHARGEBACK"])
