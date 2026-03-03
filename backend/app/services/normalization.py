import hashlib
import re
from datetime import datetime

_NOISE_TOKENS = [
    "POS",
    "DEBIT",
    "CREDIT",
    "ACH",
    "CHECKCARD",
    "PURCHASE",
    "ONLINE",
]


def normalize_description(value: str) -> str:
    text = (value or "").strip()
    text = re.sub(r"\s+", " ", text)
    upper = text.upper()
    for token in _NOISE_TOKENS:
        upper = re.sub(rf"\b{re.escape(token)}\b", "", upper)
    upper = re.sub(r"\s+", " ", upper).strip()
    return upper or text.upper()


def build_pending_fingerprint(
    account_id: str, amount: float, description_norm: str, posted_at: datetime
) -> str:
    _ = posted_at
    payload = f"{account_id}|{amount:.2f}|{description_norm}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_ingestion_hash(
    account_id: str,
    posted_at: datetime,
    amount: float,
    description_norm: str,
    provider_txn_id: str | None,
) -> str:
    payload = f"{account_id}|{posted_at.isoformat()}|{amount:.2f}|{description_norm}|{provider_txn_id or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
