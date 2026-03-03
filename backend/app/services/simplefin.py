import base64
import json
from binascii import Error as BinasciiError
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests

from app.config import settings
from app.security import redact_url_credentials

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "simplefin_accounts.json"


class SimplefinError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def _decode_setup_token(setup_token: str) -> str:
    token = setup_token.strip()
    padding = "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode(token + padding).decode("utf-8")
    except (BinasciiError, UnicodeDecodeError) as exc:
        raise SimplefinError(
            "Invalid SimpleFIN setup token format. Paste a valid setup token or access URL."
        ) from exc
    return decoded


def _looks_like_access_url(url: str) -> bool:
    parsed = urlparse(url)
    path = (parsed.path or "").rstrip("/")
    return bool(parsed.username) or path.endswith("/accounts") or path.endswith("/simplefin")


def _normalize_http_url(value: str) -> str:
    url = value.strip()
    if not url.startswith(("http://", "https://")):
        raise SimplefinError("Expected an http(s) URL")
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise SimplefinError("Invalid URL format")
    return url


def claim_access_url(setup_token: str) -> str:
    if settings.simplefin_mock:
        return "https://mock-user:mock-pass@mock.simplefin/accounts"

    token = setup_token.strip()
    if token.startswith("http://") or token.startswith("https://"):
        if _looks_like_access_url(token):
            # Allow direct paste of existing access URLs.
            return _normalize_http_url(token)
        claim_url = token
    else:
        claim_url = _decode_setup_token(token)
    try:
        response = requests.post(claim_url, timeout=20)
    except requests.RequestException as exc:
        raise SimplefinError("SimpleFIN claim request failed") from exc
    if response.status_code >= 400:
        detail = f"SimpleFIN claim failed: {response.status_code}"
        if response.status_code == 400:
            detail = (
                "SimpleFIN claim failed: 400. Setup tokens are single-use; paste the returned "
                "Access URL if this token was already claimed."
            )
        raise SimplefinError(
            detail, status_code=response.status_code
        )

    # Most implementations return JSON {"access_url": "..."}, fallback to plain body.
    content_type = response.headers.get("content-type", "")
    if "json" in content_type:
        payload = response.json()
        access_url = payload.get("access_url")
        if not access_url:
            raise SimplefinError("SimpleFIN claim response missing access_url")
        return _normalize_http_url(access_url)

    access_url = response.text.strip()
    if not access_url.startswith("http"):
        raise SimplefinError("Unexpected claim response format")
    return _normalize_http_url(access_url)


def _build_request_urls(access_url: str, params: dict[str, str]) -> list[str]:
    parsed = urlparse(_normalize_http_url(access_url))
    existing_query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    merged_query = {**existing_query, **params}
    query = urlencode(merged_query) if merged_query else ""

    base_path = (parsed.path or "").rstrip("/") or "/"
    candidate_paths = [base_path]
    if not base_path.endswith("/accounts"):
        candidate_paths.append(f"{base_path}/accounts")

    request_urls: list[str] = []
    seen: set[str] = set()
    for path in candidate_paths:
        candidate = urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                path,
                parsed.params,
                query,
                parsed.fragment,
            )
        )
        if candidate in seen:
            continue
        seen.add(candidate)
        request_urls.append(candidate)

    return request_urls


def fetch_accounts(
    access_url: str,
    *,
    start_date: datetime | None,
    end_date: datetime | None,
    include_pending: bool = True,
    balances_only: bool = False,
) -> dict:
    if settings.simplefin_mock:
        return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    params = {}
    if include_pending:
        params["pending"] = "1"
    if balances_only:
        params["balances-only"] = "1"
    if start_date:
        params["start-date"] = str(int(start_date.timestamp()))
    if end_date:
        params["end-date"] = str(int(end_date.timestamp()))

    request_urls = _build_request_urls(access_url, params)

    response = None
    attempt_failures: list[str] = []
    for request_url in request_urls:
        try:
            response = requests.get(request_url, timeout=25)
        except requests.RequestException as exc:
            attempt_failures.append(
                f"{redact_url_credentials(request_url)} -> network error ({type(exc).__name__})"
            )
            continue
        if response.status_code < 400:
            break
        attempt_failures.append(
            f"{redact_url_credentials(request_url)} -> status {response.status_code}"
        )
        response = None

    if response is None:
        attempts = "; ".join(attempt_failures) if attempt_failures else "no attempts recorded"
        raise SimplefinError(
            "SimpleFIN /accounts request failed. Verify network access and stored access URL. "
            f"Tried: {attempts}"
        )

    try:
        return response.json()
    except ValueError as exc:
        raise SimplefinError("Invalid JSON from SimpleFIN /accounts") from exc


def payload_timestamp(value: str | int | float | None) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=UTC)
    if isinstance(value, str) and value.isdigit():
        return datetime.fromtimestamp(float(value), tz=UTC)
    if value.endswith("Z"):
        value = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
