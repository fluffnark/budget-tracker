from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Transaction, Transfer
from app.services.rules import looks_like_merchant, looks_like_refund, looks_like_transfer


def detect_transfers(db: Session) -> int:
    created = 0

    route_counts: dict[tuple[str, str], int] = {}
    existing_confirmed = db.execute(
        select(Transfer, Transaction.account_id, Transaction.id)
        .join(Transaction, Transfer.txn_out_id == Transaction.id)
        .where(Transfer.status.in_(["auto_confirmed", "confirmed"]))
    ).all()
    for _, out_account_id, _ in existing_confirmed:
        # In v1 we keep route memory by out_account only for simplicity.
        route_counts[(out_account_id, "*")] = route_counts.get((out_account_id, "*"), 0) + 1

    outflows = db.execute(
        select(Transaction).where(Transaction.amount < 0).where(Transaction.transfer_id.is_(None))
    ).scalars()

    for out_txn in outflows:
        abs_amount = abs(float(out_txn.amount))
        candidates = db.execute(
            select(Transaction)
            .where(Transaction.id != out_txn.id)
            .where(Transaction.transfer_id.is_(None))
            .where(Transaction.amount > 0)
            .where(func.abs(Transaction.amount) == abs_amount)
            .where(Transaction.currency == out_txn.currency)
            .where(Transaction.posted_at >= out_txn.posted_at - timedelta(days=2))
            .where(Transaction.posted_at <= out_txn.posted_at + timedelta(days=2))
        ).scalars()

        best = None
        best_score = 0.0

        for in_txn in candidates:
            if in_txn.account_id == out_txn.account_id:
                continue

            score = _score_pair(db, out_txn, in_txn, route_counts)
            if score > best_score:
                best_score = score
                best = in_txn

        if best is None:
            continue

        status = "auto_confirmed" if best_score >= 0.85 else "proposed"
        transfer = Transfer(
            txn_out_id=out_txn.id,
            txn_in_id=best.id,
            confidence=round(best_score, 2),
            status=status,
        )
        db.add(transfer)
        db.flush()

        out_txn.transfer_id = transfer.id
        best.transfer_id = transfer.id
        created += 1

    db.flush()
    return created


def _score_pair(
    db: Session, out_txn: Transaction, in_txn: Transaction, route_counts: dict[tuple[str, str], int]
) -> float:
    score = 0.0
    score += 0.55

    days = abs((out_txn.posted_at.date() - in_txn.posted_at.date()).days)
    if days <= 1:
        score += 0.20
    elif days == 2:
        score += 0.10

    transfer_like = looks_like_transfer(out_txn.description_norm) or looks_like_transfer(
        in_txn.description_norm
    )
    if transfer_like:
        score += 0.20

    if route_counts.get((out_txn.account_id, "*"), 0) > 0:
        score += 0.10

    if (not transfer_like) and (
        looks_like_merchant(out_txn.description_norm)
        or looks_like_merchant(in_txn.description_norm)
    ):
        score -= 0.30

    if looks_like_refund(out_txn.description_norm) or looks_like_refund(in_txn.description_norm):
        score -= 0.20

    if out_txn.transfer_id or in_txn.transfer_id:
        score -= 0.20

    return max(0.0, min(1.0, score))


def list_transfers(db: Session) -> list[Transfer]:
    return db.execute(select(Transfer).order_by(Transfer.created_at.desc())).scalars().all()
