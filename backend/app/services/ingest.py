from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Callable

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Account,
    BalanceSnapshot,
    Category,
    Connection,
    Institution,
    Transaction,
)
from app.config import settings
from app.security import decrypt_access_url
from app.services.normalization import (
    build_ingestion_hash,
    build_pending_fingerprint,
    normalize_description,
)
from app.services.rules import apply_rules_to_transaction
from app.services.simplefin import fetch_accounts, payload_timestamp
from app.services.transfers import detect_transfers


class SyncError(Exception):
    pass


def _iter_sync_windows(
    *, start_date: datetime, end_date: datetime, max_window_days: int
) -> list[tuple[datetime, datetime]]:
    if end_date <= start_date:
        return [(start_date, end_date)]
    windows: list[tuple[datetime, datetime]] = []
    cursor = start_date
    delta = timedelta(days=max(1, max_window_days))
    while cursor < end_date:
        window_end = min(cursor + delta, end_date)
        windows.append((cursor, window_end))
        cursor = window_end
    return windows


def run_sync(
    db: Session,
    *,
    balances_only: bool = False,
    force_backfill: bool = False,
    progress_callback: Callable[[int, int, str], None] | None = None,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(UTC)
    connection = db.execute(
        select(Connection).where(Connection.kind == "simplefin").limit(1)
    ).scalar_one_or_none()
    if not connection:
        raise SyncError("No SimpleFIN connection configured")

    access_url = decrypt_access_url(connection.access_url_encrypted)

    start_date = None
    end_date = now
    if connection.last_sync_at and not force_backfill:
        start_date = connection.last_sync_at - timedelta(days=7)
    else:
        start_date = now - timedelta(days=max(1, settings.simplefin_initial_history_days))

    windows = _iter_sync_windows(
        start_date=start_date,
        end_date=end_date,
        max_window_days=settings.simplefin_max_window_days,
    )
    if progress_callback:
        progress_callback(
            0,
            len(windows),
            "syncing balances only" if balances_only else "syncing transactions",
        )
    seen_provider_ids: set[str] = set()
    inserted = 0
    updated = 0
    accounts_seen = 0

    for index, (window_start, window_end) in enumerate(windows):
        payload = fetch_accounts(
            access_url,
            start_date=window_start,
            end_date=window_end,
            include_pending=True,
            balances_only=balances_only,
        )
        accounts_payload = payload.get("accounts", [])
        if index == 0:
            accounts_seen = len(accounts_payload)

        # Keep balance snapshots to one capture per sync while still backfilling transactions.
        capture_balances = balances_only or index == len(windows) - 1

        for acct_payload in accounts_payload:
            provider_account_id = acct_payload.get("id")
            if provider_account_id is not None:
                seen_provider_ids.add(str(provider_account_id))
            account = _upsert_account(db, acct_payload)
            if capture_balances:
                _insert_balance_snapshot(db, account, acct_payload)

            if balances_only:
                continue

            for txn_payload in acct_payload.get("transactions", []) or []:
                changed = _upsert_transaction(db, account, txn_payload)
                if changed == "inserted":
                    inserted += 1
                elif changed == "updated":
                    updated += 1
        if progress_callback:
            progress_callback(
                index + 1,
                len(windows),
                f"processed window {index + 1}/{len(windows)}",
            )

    for txn in db.execute(
        select(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(
            and_(
                Transaction.manual_category_override.is_(False),
                or_(
                    Transaction.category_id.is_(None),
                    Category.system_kind == "uncategorized",
                ),
            )
        )
        .order_by(Transaction.posted_at.desc())
        .limit(5000)
    ).scalars():
        apply_rules_to_transaction(db, txn)

    transfer_created = detect_transfers(db)
    accounts_deactivated = _deactivate_missing_simplefin_accounts(
        db, seen_provider_ids=seen_provider_ids
    )

    connection.last_sync_at = now
    connection.status = "ok"
    db.commit()

    return {
        "accounts": accounts_seen,
        "transactions_inserted": inserted,
        "transactions_updated": updated,
        "transfers_created": transfer_created,
        "accounts_deactivated": accounts_deactivated,
        "windows_processed": len(windows),
        "synced_at": now.isoformat(),
    }


def _deactivate_missing_simplefin_accounts(db: Session, *, seen_provider_ids: set[str]) -> int:
    if not seen_provider_ids:
        return 0

    stale_accounts = db.execute(
        select(Account)
        .where(Account.source_type == "simplefin")
        .where(Account.is_active.is_(True))
        .where(Account.provider_account_id.is_not(None))
        .where(Account.provider_account_id.notin_(seen_provider_ids))
    ).scalars()

    count = 0
    for account in stale_accounts:
        account.is_active = False
        count += 1

    return count


def _upsert_account(db: Session, acct_payload: dict) -> Account:
    provider_account_id_raw = acct_payload.get("id")
    provider_account_id = (
        str(provider_account_id_raw) if provider_account_id_raw is not None else None
    )

    account = db.execute(
        select(Account)
        .where(Account.provider_account_id == provider_account_id)
        .where(Account.source_type == "simplefin")
    ).scalar_one_or_none()

    institution_name = (
        (acct_payload.get("institution") or {}).get("name")
        or (acct_payload.get("org") or {}).get("name")
        or "Unknown Institution"
    )
    institution = db.execute(
        select(Institution).where(Institution.name == institution_name)
    ).scalar_one_or_none()
    if not institution:
        institution = Institution(
            name=institution_name, provider_meta=acct_payload.get("institution") or {}
        )
        db.add(institution)
        db.flush()

    if not account:
        account = Account(
            institution_id=institution.id,
            source_type="simplefin",
            provider_account_id=provider_account_id,
            name=acct_payload.get("name") or provider_account_id,
            type=acct_payload.get("type") or acct_payload.get("account-type") or "other",
            currency=acct_payload.get("currency") or "USD",
            is_active=True,
        )
        db.add(account)
        db.flush()
    else:
        account.institution_id = institution.id
        account.name = acct_payload.get("name") or account.name
        account.type = acct_payload.get("type") or acct_payload.get("account-type") or account.type
        account.currency = acct_payload.get("currency") or account.currency
        account.is_active = True

    return account


def _to_float(value: str | int | float | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None
    return None


def _insert_balance_snapshot(db: Session, account: Account, acct_payload: dict) -> None:
    balance_payload = acct_payload.get("balance")
    if isinstance(balance_payload, dict):
        current = _to_float(balance_payload.get("current"))
        available = _to_float(balance_payload.get("available"))
        as_of = payload_timestamp(balance_payload.get("as_of"))
    else:
        current = _to_float(balance_payload)
        available = _to_float(acct_payload.get("available-balance"))
        as_of = payload_timestamp(acct_payload.get("balance-date"))

    if current is None:
        return

    snapshot = BalanceSnapshot(
        account_id=account.id,
        balance=current,
        available_balance=available,
        as_of=as_of,
    )
    db.add(snapshot)


def _parse_posted(value: str | int | float | None) -> datetime:
    if not value:
        return datetime.now(UTC)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=UTC)
    if isinstance(value, str) and value.isdigit():
        return datetime.fromtimestamp(float(value), tz=UTC)
    if len(value) == 10:
        parsed_date = date.fromisoformat(value)
        return datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=UTC)
    if value.endswith("Z"):
        value = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _upsert_transaction(db: Session, account: Account, txn_payload: dict) -> str:
    raw_provider_txn_id = txn_payload.get("id")
    provider_txn_id = str(raw_provider_txn_id) if raw_provider_txn_id is not None else None
    posted_at = _parse_posted(txn_payload.get("posted") or txn_payload.get("transacted_at"))
    amount = _to_float(txn_payload.get("amount")) or 0.0
    description_raw = (
        txn_payload.get("description") or txn_payload.get("payee") or txn_payload.get("memo") or ""
    ).strip() or "Unknown"
    description_norm = normalize_description(description_raw)
    is_pending = bool(
        txn_payload.get("pending", False)
        or txn_payload.get("is_pending", False)
        or txn_payload.get("posted") in (None, "", 0, "0")
    )
    pending_fingerprint = build_pending_fingerprint(account.id, amount, description_norm, posted_at)
    ingestion_hash = build_ingestion_hash(
        account.id, posted_at, amount, description_norm, provider_txn_id
    )

    if provider_txn_id:
        existing = db.execute(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.provider_txn_id == provider_txn_id)
        ).scalar_one_or_none()
        if existing:
            existing.posted_at = posted_at
            existing.amount = amount
            existing.currency = account.currency
            existing.description_raw = description_raw
            existing.description_norm = description_norm
            existing.is_pending = is_pending
            existing.pending_fingerprint = pending_fingerprint
            existing.ingestion_hash = ingestion_hash
            return "updated"

    if not is_pending:
        pending_candidate = db.execute(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.is_pending.is_(True))
            .where(Transaction.pending_fingerprint == pending_fingerprint)
            .where(Transaction.posted_at >= posted_at - timedelta(days=3))
            .where(Transaction.posted_at <= posted_at + timedelta(days=3))
            .where(Transaction.transfer_id.is_(None))
        ).scalar_one_or_none()
        if pending_candidate:
            pending_candidate.provider_txn_id = provider_txn_id
            pending_candidate.posted_at = posted_at
            pending_candidate.amount = amount
            pending_candidate.currency = account.currency
            pending_candidate.description_raw = description_raw
            pending_candidate.description_norm = description_norm
            pending_candidate.is_pending = False
            pending_candidate.ingestion_hash = ingestion_hash
            return "updated"

    existing_hash = db.execute(
        select(Transaction)
        .where(Transaction.account_id == account.id)
        .where(Transaction.ingestion_hash == ingestion_hash)
    ).scalar_one_or_none()
    if existing_hash:
        return "updated"

    txn = Transaction(
        account_id=account.id,
        provider_txn_id=provider_txn_id,
        posted_at=posted_at,
        amount=amount,
        currency=account.currency,
        description_raw=description_raw,
        description_norm=description_norm,
        is_pending=is_pending,
        pending_fingerprint=pending_fingerprint,
        ingestion_hash=ingestion_hash,
    )
    db.add(txn)

    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        # Best effort dedupe on race/overlap.
        return "updated"

    uncategorized_id = db.execute(
        select(Category.id).where(Category.name == "Uncategorized/Needs Review")
    ).scalar_one_or_none()
    if uncategorized_id and txn.category_id is None:
        txn.category_id = uncategorized_id

    return "inserted"
