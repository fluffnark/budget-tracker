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
    Transfer,
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


def _normalize_string(value: str | int | float | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _extract_simplefin_alias_ids(acct_payload: dict) -> set[str]:
    alias_ids: set[str] = set()
    for key in ("id", "account_id", "account-id", "provider_account_id", "provider-account-id"):
        normalized = _normalize_string(acct_payload.get(key))
        if normalized:
            alias_ids.add(normalized)
    return alias_ids


def _extract_simplefin_balance_ids(acct_payload: dict) -> set[str]:
    balance_ids: set[str] = set()
    balance_payload = acct_payload.get("balance")
    if isinstance(balance_payload, dict):
        for key in ("id", "balance_id", "balance-id", "account_id", "account-id"):
            normalized = _normalize_string(balance_payload.get(key))
            if normalized:
                balance_ids.add(normalized)
    for key in ("balance_id", "balance-id"):
        normalized = _normalize_string(acct_payload.get(key))
        if normalized:
            balance_ids.add(normalized)
    return balance_ids


def _payload_balance_signature(acct_payload: dict) -> tuple[str, str]:
    balance_payload = acct_payload.get("balance")
    if isinstance(balance_payload, dict):
        current = _normalize_string(balance_payload.get("current"))
        available = _normalize_string(balance_payload.get("available"))
        return current or "", available or ""
    current = _normalize_string(acct_payload.get("balance"))
    available = _normalize_string(acct_payload.get("available-balance"))
    return current or "", available or ""


def _canonical_account_identity(acct_payload: dict, *, institution_name: str) -> tuple[str, str, str, str]:
    return (
        institution_name.strip().lower(),
        (acct_payload.get("name") or "").strip().lower(),
        (acct_payload.get("type") or acct_payload.get("account-type") or "other").strip().lower(),
        (acct_payload.get("currency") or "USD").strip().upper(),
    )


def _sorted_unique_strings(values: set[str]) -> list[str]:
    return sorted(value for value in values if value)


def _payload_signature(acct_payload: dict, *, institution_name: str) -> str:
    org_payload = acct_payload.get("org") or acct_payload.get("institution") or {}
    org_id = _normalize_string(org_payload.get("id"))
    org_domain = _normalize_string(org_payload.get("domain"))
    balance_current, balance_available = _payload_balance_signature(acct_payload)
    transactions = acct_payload.get("transactions") or []
    transaction_markers: list[str] = []
    for txn in transactions[:5]:
        if not isinstance(txn, dict):
            continue
        marker = "|".join(
            [
                _normalize_string(txn.get("id")) or "",
                _normalize_string(txn.get("posted") or txn.get("transacted_at")) or "",
                _normalize_string(txn.get("amount")) or "",
                normalize_description(
                    (
                        txn.get("description")
                        or txn.get("payee")
                        or txn.get("memo")
                        or ""
                    ).strip()
                    or "Unknown"
                ),
            ]
        )
        transaction_markers.append(marker)
    parts = [
        institution_name.strip().lower(),
        (org_id or org_domain or institution_name).strip().lower(),
        (acct_payload.get("name") or "").strip().lower(),
        (acct_payload.get("type") or acct_payload.get("account-type") or "other").strip().lower(),
        (acct_payload.get("currency") or "USD").strip().upper(),
        balance_current,
        balance_available,
        str(len(transactions)),
        ";".join(transaction_markers),
    ]
    return "|".join(parts)


def _account_meta_values(account: Account, key: str) -> set[str]:
    meta = account.provider_meta or {}
    raw_values = meta.get(key) or []
    if not isinstance(raw_values, list):
        return set()
    return {str(value).strip() for value in raw_values if str(value).strip()}


def _update_account_provider_meta(
    account: Account,
    *,
    alias_ids: set[str],
    balance_ids: set[str],
    payload_signatures: set[str] | None = None,
    institution_name: str | None = None,
) -> None:
    meta = dict(account.provider_meta or {})
    meta["simplefin_alias_ids"] = _sorted_unique_strings(
        _account_meta_values(account, "simplefin_alias_ids") | alias_ids
    )
    meta["simplefin_balance_ids"] = _sorted_unique_strings(
        _account_meta_values(account, "simplefin_balance_ids") | balance_ids
    )
    meta["simplefin_payload_signatures"] = _sorted_unique_strings(
        _account_meta_values(account, "simplefin_payload_signatures") | (payload_signatures or set())
    )
    if institution_name:
        meta["simplefin_institution_name"] = institution_name
    account.provider_meta = meta


def _select_survivor(accounts: list[Account]) -> Account:
    return sorted(
        accounts,
        key=lambda account: (
            0 if account.is_active else 1,
            account.created_at or datetime.max.replace(tzinfo=UTC),
            account.id,
        ),
    )[0]


def _relink_transfer_reference(db: Session, *, duplicate_txn: Transaction, survivor_txn: Transaction) -> None:
    duplicate_transfer = duplicate_txn.transfer_id
    if duplicate_transfer is None:
        return
    if survivor_txn.transfer_id is None:
        survivor_txn.transfer_id = duplicate_transfer

    outgoing = db.execute(select(Transfer).where(Transfer.txn_out_id == duplicate_txn.id)).scalar_one_or_none()
    if outgoing and outgoing.txn_out_id != survivor_txn.id:
        outgoing.txn_out_id = survivor_txn.id

    incoming = db.execute(select(Transfer).where(Transfer.txn_in_id == duplicate_txn.id)).scalar_one_or_none()
    if incoming and incoming.txn_in_id != survivor_txn.id:
        incoming.txn_in_id = survivor_txn.id


def _merge_transaction_record(
    db: Session,
    *,
    survivor_txn: Transaction,
    duplicate_txn: Transaction,
) -> None:
    if survivor_txn.provider_txn_id is None and duplicate_txn.provider_txn_id is not None:
        survivor_txn.provider_txn_id = duplicate_txn.provider_txn_id
    if survivor_txn.merchant_id is None and duplicate_txn.merchant_id is not None:
        survivor_txn.merchant_id = duplicate_txn.merchant_id
    if (
        (survivor_txn.category_id is None or not survivor_txn.manual_category_override)
        and duplicate_txn.category_id is not None
    ):
        survivor_txn.category_id = duplicate_txn.category_id
        survivor_txn.manual_category_override = duplicate_txn.manual_category_override
    if not survivor_txn.notes and duplicate_txn.notes:
        survivor_txn.notes = duplicate_txn.notes
    if survivor_txn.is_pending and not duplicate_txn.is_pending:
        survivor_txn.is_pending = False
        survivor_txn.posted_at = duplicate_txn.posted_at
    _relink_transfer_reference(db, duplicate_txn=duplicate_txn, survivor_txn=survivor_txn)
    db.delete(duplicate_txn)


def _merge_accounts(db: Session, *, survivor: Account, duplicate: Account) -> None:
    if survivor.id == duplicate.id:
        return

    target_transactions = db.execute(
        select(Transaction).where(Transaction.account_id == survivor.id)
    ).scalars().all()
    by_provider_id = {
        txn.provider_txn_id: txn for txn in target_transactions if txn.provider_txn_id is not None
    }
    by_ingestion_hash = {txn.ingestion_hash: txn for txn in target_transactions}

    duplicate_transactions = db.execute(
        select(Transaction).where(Transaction.account_id == duplicate.id)
    ).scalars().all()
    for txn in duplicate_transactions:
        amount = float(txn.amount)
        new_pending_fingerprint = build_pending_fingerprint(
            survivor.id, amount, txn.description_norm, txn.posted_at
        )
        new_ingestion_hash = build_ingestion_hash(
            survivor.id, txn.posted_at, amount, txn.description_norm, txn.provider_txn_id
        )
        existing = None
        if txn.provider_txn_id is not None:
            existing = by_provider_id.get(txn.provider_txn_id)
        if existing is None:
            existing = by_ingestion_hash.get(new_ingestion_hash)

        if existing is not None:
            _merge_transaction_record(db, survivor_txn=existing, duplicate_txn=txn)
            continue

        txn.account_id = survivor.id
        txn.pending_fingerprint = new_pending_fingerprint
        txn.ingestion_hash = new_ingestion_hash
        by_ingestion_hash[new_ingestion_hash] = txn
        if txn.provider_txn_id is not None:
            by_provider_id[txn.provider_txn_id] = txn

    for snapshot in db.execute(
        select(BalanceSnapshot).where(BalanceSnapshot.account_id == duplicate.id)
    ).scalars():
        snapshot.account_id = survivor.id

    survivor.is_active = survivor.is_active or duplicate.is_active
    survivor.name = survivor.name or duplicate.name
    survivor.type = survivor.type or duplicate.type
    survivor.currency = survivor.currency or duplicate.currency
    if duplicate.institution_id and survivor.institution_id is None:
        survivor.institution_id = duplicate.institution_id
    _update_account_provider_meta(
        survivor,
        alias_ids=_account_meta_values(duplicate, "simplefin_alias_ids")
        | ({duplicate.provider_account_id} if duplicate.provider_account_id else set()),
        balance_ids=_account_meta_values(duplicate, "simplefin_balance_ids"),
        payload_signatures=_account_meta_values(duplicate, "simplefin_payload_signatures"),
    )
    db.delete(duplicate)


def _matching_simplefin_accounts(
    db: Session,
    *,
    alias_ids: set[str],
    balance_ids: set[str],
    payload_signature: str,
    identity: tuple[str, str, str, str],
) -> list[Account]:
    simplefin_accounts = db.execute(
        select(Account).where(Account.source_type == "simplefin")
    ).scalars().all()

    exact_matches: list[Account] = []
    alias_matches: list[Account] = []
    balance_matches: list[Account] = []
    payload_signature_matches: list[Account] = []
    identity_matches: list[Account] = []
    for account in simplefin_accounts:
        account_aliases = _account_meta_values(account, "simplefin_alias_ids")
        if account.provider_account_id:
            account_aliases.add(account.provider_account_id)
        account_balance_ids = _account_meta_values(account, "simplefin_balance_ids")
        account_payload_signatures = _account_meta_values(account, "simplefin_payload_signatures")
        account_identity = (
            (
                account.institution.name.strip().lower()
                if account.institution and account.institution.name
                else ""
            ),
            account.name.strip().lower(),
            account.type.strip().lower(),
            account.currency.strip().upper(),
        )

        if account.provider_account_id and account.provider_account_id in alias_ids:
            exact_matches.append(account)
            continue
        if alias_ids & account_aliases:
            alias_matches.append(account)
            continue
        if balance_ids and balance_ids & account_balance_ids:
            balance_matches.append(account)
            continue
        if payload_signature and payload_signature in account_payload_signatures:
            payload_signature_matches.append(account)
            continue
        if balance_ids and account_identity == identity:
            identity_matches.append(account)

    def _unique(accounts: list[Account]) -> list[Account]:
        seen: set[str] = set()
        output: list[Account] = []
        for account in accounts:
            if account.id in seen:
                continue
            seen.add(account.id)
            output.append(account)
        return output

    if exact_matches:
        return _unique(exact_matches + alias_matches + balance_matches + payload_signature_matches)
    if alias_matches:
        return _unique(alias_matches + balance_matches + payload_signature_matches)
    if balance_matches:
        return _unique(balance_matches + payload_signature_matches)
    if payload_signature_matches:
        return _unique(payload_signature_matches)
    if len(identity_matches) > 1:
        return _unique(identity_matches)
    return []


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
    alias_ids = _extract_simplefin_alias_ids(acct_payload)
    balance_ids = _extract_simplefin_balance_ids(acct_payload)
    payload_signature = _payload_signature(acct_payload, institution_name=institution_name)
    identity = _canonical_account_identity(acct_payload, institution_name=institution_name)
    institution = db.execute(
        select(Institution).where(Institution.name == institution_name)
    ).scalar_one_or_none()
    if not institution:
        institution = Institution(
            name=institution_name, provider_meta=acct_payload.get("institution") or {}
        )
        db.add(institution)
        db.flush()

    matching_accounts = _matching_simplefin_accounts(
        db,
        alias_ids=alias_ids,
        balance_ids=balance_ids,
        payload_signature=payload_signature,
        identity=identity,
    )
    if account and account not in matching_accounts:
        matching_accounts.append(account)
    if matching_accounts:
        account = _select_survivor(matching_accounts)
        for duplicate in matching_accounts:
            if duplicate.id == account.id:
                continue
            _merge_accounts(db, survivor=account, duplicate=duplicate)

    if not account:
        account = Account(
            institution_id=institution.id,
            source_type="simplefin",
            provider_account_id=provider_account_id,
            provider_meta={},
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
        account.provider_account_id = provider_account_id or account.provider_account_id

    _update_account_provider_meta(
        account,
        alias_ids=alias_ids,
        balance_ids=balance_ids,
        payload_signatures={payload_signature},
        institution_name=institution_name,
    )

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
