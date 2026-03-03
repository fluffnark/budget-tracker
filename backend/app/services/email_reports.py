from __future__ import annotations

import json
import smtplib
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, Category, Transaction
from app.security import decrypt_access_url, encrypt_access_url
from app.services.exporter import build_llm_export
from app.services.reports import monthly_report


@dataclass
class EmailReportSettings:
    enabled: bool
    recipients: list[str]
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from: str
    smtp_use_tls: bool
    smtp_use_ssl: bool
    report_day: int
    report_hour: int
    report_minute: int


def _get_setting(db: Session, key: str, default: str) -> str:
    row = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
    if row is None:
        return default
    return row.value


def _parse_bool(value: str) -> bool:
    return value.strip() in {"1", "true", "True", "yes", "on"}


def load_email_report_settings(db: Session) -> EmailReportSettings:
    encrypted_password = _get_setting(db, "smtp_password_encrypted", "")
    smtp_password = decrypt_access_url(encrypted_password) if encrypted_password else ""
    recipients = [
        email.strip()
        for email in _get_setting(db, "email_report_recipients", "").split(",")
        if email.strip()
    ]
    return EmailReportSettings(
        enabled=_parse_bool(_get_setting(db, "email_reports_enabled", "0")),
        recipients=recipients,
        smtp_host=_get_setting(db, "smtp_host", ""),
        smtp_port=int(_get_setting(db, "smtp_port", "587")),
        smtp_username=_get_setting(db, "smtp_username", ""),
        smtp_password=smtp_password,
        smtp_from=_get_setting(db, "smtp_from", ""),
        smtp_use_tls=_parse_bool(_get_setting(db, "smtp_use_tls", "1")),
        smtp_use_ssl=_parse_bool(_get_setting(db, "smtp_use_ssl", "0")),
        report_day=int(_get_setting(db, "email_report_day", "1")),
        report_hour=int(_get_setting(db, "email_report_hour", "12")),
        report_minute=int(_get_setting(db, "email_report_minute", "0")),
    )


def set_smtp_password(db: Session, smtp_password: str) -> None:
    encrypted = encrypt_access_url(smtp_password)
    row = (
        db.execute(select(AppSetting).where(AppSetting.key == "smtp_password_encrypted"))
        .scalar_one_or_none()
    )
    if row is None:
        row = AppSetting(key="smtp_password_encrypted", value=encrypted)
        db.add(row)
    else:
        row.value = encrypted


def _previous_month_range(today: date | None = None) -> tuple[date, date]:
    today = today or datetime.now(UTC).date()
    first_this_month = date(today.year, today.month, 1)
    last_prev_month = first_this_month - timedelta(days=1)
    first_prev_month = date(last_prev_month.year, last_prev_month.month, 1)
    return first_prev_month, last_prev_month


def _count_uncategorized(db: Session, *, start: date, end: date) -> int:
    uncategorized_ids = set(
        db.execute(select(Category.id).where(Category.system_kind == "uncategorized")).scalars()
    )
    rows = db.execute(
        select(Transaction.category_id)
        .where(Transaction.posted_at >= datetime.combine(start, datetime.min.time(), tzinfo=UTC))
        .where(
            Transaction.posted_at
            < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        )
    ).scalars()
    total = 0
    for category_id in rows:
        if category_id is None or category_id in uncategorized_ids:
            total += 1
    return total


def _render_email_text(
    *,
    start: date,
    end: date,
    report: dict,
    uncategorized_count: int,
) -> str:
    totals = report["totals"]
    top_categories = report.get("category_breakdown", [])[:8]
    deltas = report.get("mom_deltas", [])[:5]
    lines = [
        f"Budget Tracker Monthly Report ({start.isoformat()} to {end.isoformat()})",
        "",
        f"Inflow: ${totals['inflow']:.2f}",
        f"Outflow: ${totals['outflow']:.2f}",
        f"Net: ${totals['net']:.2f}",
        f"Uncategorized transactions: {uncategorized_count}",
        "",
        "Top spend categories:",
    ]
    for row in top_categories:
        lines.append(f"- {row['category']}: ${row['amount']:.2f}")
    if deltas:
        lines.append("")
        lines.append("Largest month-over-month changes:")
        for row in deltas:
            delta = float(row.get("delta", 0.0))
            sign = "+" if delta >= 0 else ""
            lines.append(f"- {row['category']}: {sign}${delta:.2f}")
    lines.extend(
        [
            "",
            "Attachments:",
            "- llm_prompt.md (ready-to-copy instructions + data context)",
            "- llm_payload.json (machine-readable transactions/categories/summary)",
        ]
    )
    return "\n".join(lines)


def _build_email_message(
    *,
    cfg: EmailReportSettings,
    start: date,
    end: date,
    report: dict,
    uncategorized_count: int,
    llm_payload: dict,
    llm_prompt: str,
) -> EmailMessage:
    subject = f"Budget Report {start.strftime('%Y-%m')}"
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg.smtp_from
    msg["To"] = ", ".join(cfg.recipients)
    msg.set_content(
        _render_email_text(
            start=start,
            end=end,
            report=report,
            uncategorized_count=uncategorized_count,
        )
    )

    attachment_base = {
        "transactions": llm_payload.get("transactions", []),
        "categories": llm_payload.get("categories", []),
        "category_tree": llm_payload.get("category_tree", []),
        "summary": llm_payload.get("summary", []),
    }
    prompt_markdown = f"""{llm_prompt}

## Input Data (JSON)
```json
{json.dumps(attachment_base, indent=2)}
```
"""
    msg.add_attachment(
        prompt_markdown.encode("utf-8"),
        maintype="text",
        subtype="markdown",
        filename="llm_prompt.md",
    )
    msg.add_attachment(
        json.dumps(attachment_base, indent=2).encode("utf-8"),
        maintype="application",
        subtype="json",
        filename="llm_payload.json",
    )
    return msg


def send_monthly_email_report(
    db: Session,
    *,
    force_send: bool = False,
    today: date | None = None,
) -> dict:
    cfg = load_email_report_settings(db)
    if not cfg.enabled and not force_send:
        return {"sent": False, "reason": "disabled"}
    if not cfg.recipients:
        return {"sent": False, "reason": "missing_recipients"}
    if not cfg.smtp_host or not cfg.smtp_from:
        return {"sent": False, "reason": "missing_smtp_host_or_from"}
    if cfg.smtp_use_ssl and cfg.smtp_use_tls:
        return {"sent": False, "reason": "invalid_smtp_security_mode"}

    start, end = _previous_month_range(today=today)
    report = monthly_report(
        db,
        year=start.year,
        month=start.month,
        include_pending=True,
        include_transfers=False,
    )
    uncategorized_count = _count_uncategorized(db, start=start, end=end)
    llm_payload = build_llm_export(
        db,
        start=start,
        end=end,
        scrub=True,
        hash_merchants=False,
        round_amounts=False,
    )
    llm_prompt = llm_payload.get("prompt_template", "")
    msg = _build_email_message(
        cfg=cfg,
        start=start,
        end=end,
        report=report,
        uncategorized_count=uncategorized_count,
        llm_payload=llm_payload,
        llm_prompt=llm_prompt,
    )

    if cfg.smtp_use_ssl:
        with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=20) as smtp:
            if cfg.smtp_username:
                smtp.login(cfg.smtp_username, cfg.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as smtp:
            smtp.ehlo()
            if cfg.smtp_use_tls:
                smtp.starttls()
                smtp.ehlo()
            if cfg.smtp_username:
                smtp.login(cfg.smtp_username, cfg.smtp_password)
            smtp.send_message(msg)

    return {
        "sent": True,
        "subject": msg["Subject"],
        "start": start.isoformat(),
        "end": end.isoformat(),
        "recipient_count": len(cfg.recipients),
        "uncategorized_count": uncategorized_count,
        "transaction_count": len(llm_payload.get("transactions", [])),
    }
