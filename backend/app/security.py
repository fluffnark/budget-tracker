import base64
import hashlib
import re
from urllib.parse import urlparse, urlunparse

from cryptography.fernet import Fernet
from itsdangerous import BadSignature, URLSafeSerializer
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

_SECRET_PATTERNS = [
    re.compile(r"Authorization\s*:\s*Basic\s+[A-Za-z0-9+/=]+", re.IGNORECASE),
    re.compile(r"https?://[^\s/@:]+:[^\s/@]+@", re.IGNORECASE),
    re.compile(r"setup_token=[^&\s]+", re.IGNORECASE),
    re.compile(r"access_url=[^&\s]+", re.IGNORECASE),
]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def _get_fernet() -> Fernet:
    try:
        key_bytes = base64.urlsafe_b64decode(settings.master_key.encode("utf-8"))
        if len(key_bytes) != 32:
            raise ValueError("MASTER_KEY must decode to exactly 32 bytes")
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Invalid MASTER_KEY; expected urlsafe base64 32-byte key") from exc
    return Fernet(settings.master_key.encode("utf-8"))


def encrypt_access_url(access_url: str) -> str:
    return _get_fernet().encrypt(access_url.encode("utf-8")).decode("utf-8")


def decrypt_access_url(access_url_encrypted: str) -> str:
    return _get_fernet().decrypt(access_url_encrypted.encode("utf-8")).decode("utf-8")


def get_session_serializer() -> URLSafeSerializer:
    return URLSafeSerializer(settings.session_secret, salt="budget-session")


def create_session_cookie(owner_id: int) -> str:
    return get_session_serializer().dumps({"owner_id": owner_id})


def read_session_cookie(value: str) -> int | None:
    try:
        payload = get_session_serializer().loads(value)
    except BadSignature:
        return None
    owner_id = payload.get("owner_id")
    return int(owner_id) if owner_id else None


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def scrub_secrets(text: str) -> str:
    scrubbed = text
    for pattern in _SECRET_PATTERNS:
        scrubbed = pattern.sub("[REDACTED]", scrubbed)
    return scrubbed


def redact_url_credentials(url: str) -> str:
    parsed = urlparse(url)
    if parsed.username or parsed.password:
        host = parsed.hostname or ""
        if parsed.port:
            host = f"{host}:{parsed.port}"
        return urlunparse(
            (parsed.scheme, host, parsed.path, parsed.params, parsed.query, parsed.fragment)
        )
    return url
