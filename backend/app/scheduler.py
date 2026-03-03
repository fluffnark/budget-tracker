from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AppSetting
from app.services.email_reports import load_email_report_settings, send_monthly_email_report
from app.services.ingest import run_sync

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


def _sync_job() -> None:
    db = SessionLocal()
    try:
        run_sync(db, balances_only=False)
        logger.info("Daily sync completed")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.exception("Daily sync failed: %s", exc)
    finally:
        db.close()


def _email_report_job() -> None:
    db = SessionLocal()
    try:
        result = send_monthly_email_report(db, force_send=False)
        if result.get("sent"):
            logger.info("Scheduled email report sent: %s", result.get("subject", ""))
        else:
            logger.info("Scheduled email report skipped: %s", result.get("reason", "unknown"))
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.exception("Scheduled email report failed: %s", exc)
    finally:
        db.close()


def _get_setting_int(db, key: str, default: int) -> int:
    row = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
    if not row:
        return default
    try:
        return int(row.value)
    except ValueError:
        return default


def schedule_daily_sync(default_hour: int, default_minute: int) -> None:
    db = SessionLocal()
    try:
        hour = _get_setting_int(db, "sync_daily_hour", default_hour)
        minute = _get_setting_int(db, "sync_daily_minute", default_minute)
    finally:
        db.close()

    if scheduler.get_job("daily_sync"):
        scheduler.remove_job("daily_sync")

    scheduler.add_job(_sync_job, "cron", id="daily_sync", hour=hour, minute=minute)


def start_scheduler(default_hour: int, default_minute: int) -> None:
    if scheduler.running:
        return
    schedule_daily_sync(default_hour, default_minute)
    schedule_email_report()
    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


def schedule_email_report() -> None:
    db = SessionLocal()
    try:
        cfg = load_email_report_settings(db)
    finally:
        db.close()

    if scheduler.get_job("monthly_email_report"):
        scheduler.remove_job("monthly_email_report")

    if not cfg.enabled:
        return

    scheduler.add_job(
        _email_report_job,
        "cron",
        id="monthly_email_report",
        day=cfg.report_day,
        hour=cfg.report_hour,
        minute=cfg.report_minute,
    )
