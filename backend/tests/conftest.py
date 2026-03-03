from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.bootstrap import ensure_seed_data
from app.config import settings
from app.db import Base
from app.main import app

settings.simplefin_mock = True
settings.testing = True


def _derive_test_database_url() -> str:
    explicit = os.getenv("TEST_DATABASE_URL")
    if explicit:
        return explicit

    base = make_url(settings.database_url)
    if not base.drivername.startswith("postgresql"):
        raise RuntimeError(
            "Refusing to run tests against non-Postgres DATABASE_URL without TEST_DATABASE_URL."
        )

    db_name = base.database or "budget"
    if db_name.endswith("_test"):
        return str(base)
    return str(base.set(database=f"{db_name}_test"))


def _ensure_safe_test_db_url(database_url: str) -> None:
    parsed = make_url(database_url)
    db_name = parsed.database or ""
    if db_name in {"", "budget", "postgres"} or not db_name.endswith("_test"):
        raise RuntimeError(
            f"Unsafe test database '{db_name}'. Use TEST_DATABASE_URL ending in '_test'."
        )


def _ensure_postgres_database_exists(database_url: str) -> None:
    parsed = make_url(database_url)
    db_name = parsed.database or ""
    if not re.fullmatch(r"[A-Za-z0-9_]+", db_name):
        raise RuntimeError(f"Unsafe test database name '{db_name}'")

    admin_url = str(parsed.set(database="postgres"))
    admin_engine = create_engine(admin_url, pool_pre_ping=True, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": db_name},
            ).scalar_one_or_none()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    finally:
        admin_engine.dispose()


@pytest.fixture(scope="session")
def engine():
    test_url = _derive_test_database_url()
    _ensure_safe_test_db_url(test_url)
    _ensure_postgres_database_exists(test_url)
    return create_engine(test_url, pool_pre_ping=True)


@pytest.fixture()
def db_session(engine) -> Session:
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = TestingSessionLocal()
    ensure_seed_data(session)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    from app.db import get_db

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as c:
        login_resp = c.post(
            "/api/auth/login",
            json={"email": "owner@example.com", "password": "test-password"},
        )
        assert login_resp.status_code == 200
        yield c

    app.dependency_overrides.clear()


@pytest.fixture()
def fixture_path() -> Path:
    return Path(__file__).resolve().parents[1] / "fixtures" / "simplefin_accounts.json"


@pytest.fixture()
def fixture_backup(fixture_path: Path):
    original = fixture_path.read_text(encoding="utf-8")
    try:
        yield
    finally:
        fixture_path.write_text(original, encoding="utf-8")
