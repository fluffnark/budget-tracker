from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Category, ClassificationRule, Transaction, Transfer


def _claim_and_sync(client):
    claim = client.post("/api/simplefin/claim", json={"setup_token": "mock-token"})
    assert claim.status_code == 200
    sync = client.post("/api/sync/run", json={"balances_only": False})
    assert sync.status_code == 200
    return sync.json()


def test_transfer_matching_auto_confirm_high_confidence(client, db_session: Session):
    _claim_and_sync(client)

    transfers = db_session.execute(select(Transfer)).scalars().all()
    assert len(transfers) >= 1
    assert any(float(t.confidence) >= 0.85 and t.status == "auto_confirmed" for t in transfers)


def test_idempotent_ingestion_no_duplicates(client, db_session: Session):
    _claim_and_sync(client)
    count1 = db_session.execute(select(Transaction)).scalars().all()

    _claim_and_sync(client)
    count2 = db_session.execute(select(Transaction)).scalars().all()

    assert len(count1) == len(count2)


def test_pending_to_posted_reconciliation(
    client, db_session: Session, fixture_path, fixture_backup
):
    payload_pending = {
        "accounts": [
            {
                "id": "slfcu-checking-001",
                "name": "SLFCU Checking",
                "type": "checking",
                "currency": "USD",
                "institution": {"name": "Sandia Laboratory Federal Credit Union"},
                "balance": {
                    "current": 3000.0,
                    "available": 2950.0,
                    "as_of": "2026-02-20T12:00:00Z",
                },
                "transactions": [
                    {
                        "id": "pending-a",
                        "posted": "2026-02-20",
                        "amount": -50.0,
                        "description": "Coffee Shop",
                        "pending": True,
                    }
                ],
            }
        ]
    }
    fixture_path.write_text(json.dumps(payload_pending), encoding="utf-8")

    _claim_and_sync(client)

    payload_posted = {
        "accounts": [
            {
                "id": "slfcu-checking-001",
                "name": "SLFCU Checking",
                "type": "checking",
                "currency": "USD",
                "institution": {"name": "Sandia Laboratory Federal Credit Union"},
                "balance": {
                    "current": 3000.0,
                    "available": 2950.0,
                    "as_of": "2026-02-21T12:00:00Z",
                },
                "transactions": [
                    {
                        "id": "posted-a",
                        "posted": "2026-02-21",
                        "amount": -50.0,
                        "description": "Coffee Shop",
                        "pending": False,
                    }
                ],
            }
        ]
    }
    fixture_path.write_text(json.dumps(payload_posted), encoding="utf-8")

    sync = client.post("/api/sync/run", json={"balances_only": False})
    assert sync.status_code == 200

    rows = (
        db_session.execute(
            select(Transaction).where(Transaction.description_norm.like("%COFFEE SHOP%"))
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].is_pending is False


def test_export_scrub_removes_sensitive_fields(client):
    _claim_and_sync(client)

    response = client.get(
        "/api/export/llm",
        params={"start": "2026-01-01", "end": "2026-12-31", "scrub": 1, "hash_merchants": 1},
    )
    assert response.status_code == 200

    payload = response.json()["payload"]
    txns = payload["transactions"]
    assert txns
    for txn in txns:
        assert "account_name" not in txn
        assert "description_raw" not in txn

    blob = json.dumps(payload)
    assert "access_url" not in blob.lower()
    assert "mock-user" not in blob


def test_rule_preview_count_matches_expected(client, db_session: Session):
    _claim_and_sync(client)

    transportation_id = db_session.execute(
        select(Category.id).where(Category.name == "Transportation")
    ).scalar_one()

    resp = client.post(
        "/api/rules/preview",
        json={
            "priority": 90,
            "match_type": "contains",
            "pattern": "GAS STATION",
            "category_id": transportation_id,
        },
    )
    assert resp.status_code == 200
    payload = resp.json()

    expected = len(
        db_session.execute(
            select(Transaction).where(Transaction.description_norm.like("%GAS STATION%"))
        )
        .scalars()
        .all()
    )
    assert payload["match_count"] == expected
    assert len(payload["sample_transaction_ids"]) <= payload["match_count"]


def test_rule_create_returns_applied_count(client, db_session: Session):
    _claim_and_sync(client)

    transportation_id = db_session.execute(
        select(Category.id).where(Category.name == "Transportation")
    ).scalar_one()

    resp = client.post(
        "/api/rules",
        json={
            "priority": 90,
            "match_type": "contains",
            "pattern": "GAS STATION",
            "category_id": transportation_id,
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["match_count"] >= 1
    assert payload["sample_transaction_ids"]

    txns = (
        db_session.execute(
            select(Transaction).where(Transaction.description_norm.like("%GAS STATION%"))
        )
        .scalars()
        .all()
    )
    assert txns
    assert all(txn.category_id == transportation_id for txn in txns)


def test_rule_does_not_override_manual_category(client, db_session: Session):
    _claim_and_sync(client)

    food_id = db_session.execute(select(Category.id).where(Category.name == "Food")).scalar_one()
    transportation_id = db_session.execute(
        select(Category.id).where(Category.name == "Transportation")
    ).scalar_one()
    target_txn = db_session.execute(
        select(Transaction).where(Transaction.description_norm.like("%GAS STATION%"))
    ).scalar_one()

    patch = client.patch(
        f"/api/transactions/{target_txn.id}",
        json={"category_id": food_id},
    )
    assert patch.status_code == 200
    assert patch.json()["manual_category_override"] is True

    create_rule = client.post(
        "/api/rules",
        json={
            "priority": 80,
            "match_type": "contains",
            "pattern": "GAS STATION",
            "category_id": transportation_id,
        },
    )
    assert create_rule.status_code == 200

    updated = db_session.execute(
        select(Transaction).where(Transaction.id == target_txn.id)
    ).scalar_one()
    assert updated.category_id == food_id
    assert updated.manual_category_override is True


def test_export_includes_category_paths(client):
    _claim_and_sync(client)

    response = client.get(
        "/api/export/llm",
        params={
            "start": "2026-01-01",
            "end": "2026-12-31",
            "scrub": 1,
            "hash_merchants": 1,
        },
    )
    assert response.status_code == 200
    payload = response.json()["payload"]

    assert payload["categories"]
    assert all("full_path" in category for category in payload["categories"])
    assert "category_tree" in payload
    assert payload["transactions"]
    first = payload["transactions"][0]
    assert "category_id" in first
    assert "category_path" in first


def test_reports_exclude_transfers_from_spend(client):
    _claim_and_sync(client)

    params = {"start": "2026-02-01", "end": "2026-02-28", "include_pending": 1}
    without_transfers = client.get("/api/reports/weekly", params={**params, "include_transfers": 0})
    with_transfers = client.get("/api/reports/weekly", params={**params, "include_transfers": 1})

    assert without_transfers.status_code == 200
    assert with_transfers.status_code == 200

    outflow_without = without_transfers.json()["totals"]["outflow"]
    outflow_with = with_transfers.json()["totals"]["outflow"]

    assert outflow_with >= outflow_without
    assert outflow_with - outflow_without >= 800


def test_suggest_excludes_categorized_and_transfers_by_default(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    try:
        transportation_id = db_session.execute(
            select(Category.id).where(Category.name == "Transportation")
        ).scalar_one()
        transfer_id = db_session.execute(select(Transfer.id).limit(1)).scalar_one()
        txns = db_session.execute(select(Transaction).limit(4)).scalars().all()
        assert len(txns) == 4

        txns[0].description_norm = "AUTO FUEL MERCHANT"
        txns[0].category_id = transportation_id
        txns[0].manual_category_override = False
        txns[0].transfer_id = None

        txns[1].description_norm = "AUTO FUEL MERCHANT"
        txns[1].category_id = transportation_id
        txns[1].manual_category_override = False
        txns[1].transfer_id = None

        txns[2].description_norm = "AUTO FUEL MERCHANT"
        txns[2].category_id = None
        txns[2].manual_category_override = False
        txns[2].transfer_id = None

        txns[3].description_norm = "AUTO FUEL MERCHANT"
        txns[3].category_id = None
        txns[3].manual_category_override = False
        txns[3].transfer_id = transfer_id
        db_session.commit()

        resp = client.post(
            "/api/categorization/suggest",
            json={
                "start": "2026-01-01",
                "end": "2026-12-31",
                "include_pending": True,
                "max_suggestions": 200,
            },
        )
        assert resp.status_code == 200
        suggestions = resp.json()["suggestions"]
        suggested_ids = {row["transaction_id"] for row in suggestions}
        assert txns[2].id in suggested_ids
        assert txns[0].id not in suggested_ids
        assert txns[3].id not in suggested_ids
    finally:
        settings.auto_categorization = False


def test_suggest_respects_date_range_and_account_filter(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    try:
        transportation_id = db_session.execute(
            select(Category.id).where(Category.name == "Transportation")
        ).scalar_one()
        txns = db_session.execute(select(Transaction).limit(4)).scalars().all()
        assert len(txns) == 4

        txns[0].posted_at = datetime(2026, 2, 10, tzinfo=UTC)
        txns[0].description_norm = "CITY WATER BILL"
        txns[0].category_id = transportation_id
        txns[0].manual_category_override = False

        txns[1].posted_at = datetime(2026, 2, 11, tzinfo=UTC)
        txns[1].description_norm = "CITY WATER BILL"
        txns[1].category_id = transportation_id
        txns[1].manual_category_override = False

        txns[2].posted_at = datetime(2026, 2, 12, tzinfo=UTC)
        txns[2].description_norm = "CITY WATER BILL"
        txns[2].category_id = None
        txns[2].manual_category_override = False

        txns[3].posted_at = datetime(2026, 1, 2, tzinfo=UTC)
        txns[3].description_norm = "CITY WATER BILL"
        txns[3].category_id = None
        txns[3].manual_category_override = False
        db_session.commit()

        resp = client.post(
            "/api/categorization/suggest",
            json={
                "start": "2026-02-01",
                "end": "2026-02-28",
                "account_ids": [txns[2].account_id],
                "include_pending": True,
            },
        )
        assert resp.status_code == 200
        suggested_ids = {row["transaction_id"] for row in resp.json()["suggestions"]}
        assert txns[2].id in suggested_ids
        assert txns[3].id not in suggested_ids
    finally:
        settings.auto_categorization = False


def test_apply_skips_manual_category(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    try:
        food_id = db_session.execute(
            select(Category.id).where(Category.name == "Food")
        ).scalar_one()
        transportation_id = db_session.execute(
            select(Category.id).where(Category.name == "Transportation")
        ).scalar_one()

        target_txn = db_session.execute(
            select(Transaction).where(Transaction.description_norm.like("%GAS STATION%"))
        ).scalar_one()
        target_txn.category_id = food_id
        target_txn.manual_category_override = True
        db_session.commit()

        apply_resp = client.post(
            "/api/categorization/apply",
            json={
                "suggestions": [
                    {
                        "transaction_id": target_txn.id,
                        "suggested_category_id": transportation_id,
                        "confidence": 0.99,
                    }
                ],
                "min_confidence": 0.85,
            },
        )
        assert apply_resp.status_code == 200
        payload = apply_resp.json()
        assert payload["applied_count"] == 0
        assert payload["skipped_reasons"]["manual_override"] == 1

        reloaded = db_session.execute(
            select(Transaction).where(Transaction.id == target_txn.id)
        ).scalar_one()
        assert reloaded.category_id == food_id
        assert reloaded.manual_category_override is True
    finally:
        settings.auto_categorization = False


def test_apply_respects_min_confidence_threshold(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    try:
        transportation_id = db_session.execute(
            select(Category.id).where(Category.name == "Transportation")
        ).scalar_one()
        target_txn = db_session.execute(select(Transaction).limit(1)).scalar_one()
        target_txn.category_id = None
        target_txn.manual_category_override = False
        db_session.commit()

        apply_resp = client.post(
            "/api/categorization/apply",
            json={
                "suggestions": [
                    {
                        "transaction_id": target_txn.id,
                        "suggested_category_id": transportation_id,
                        "confidence": 0.74,
                    }
                ],
                "min_confidence": 0.85,
            },
        )
        assert apply_resp.status_code == 200
        payload = apply_resp.json()
        assert payload["applied_count"] == 0
        assert payload["skipped_reasons"]["below_confidence_threshold"] == 1

        reloaded = db_session.execute(
            select(Transaction).where(Transaction.id == target_txn.id)
        ).scalar_one()
        assert reloaded.category_id is None
    finally:
        settings.auto_categorization = False


def test_apply_is_idempotent_same_suggestions_twice(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    try:
        transportation_id = db_session.execute(
            select(Category.id).where(Category.name == "Transportation")
        ).scalar_one()
        target_txn = db_session.execute(select(Transaction).limit(1)).scalar_one()
        target_txn.category_id = None
        target_txn.manual_category_override = False
        db_session.commit()

        payload = {
            "suggestions": [
                {
                    "transaction_id": target_txn.id,
                    "suggested_category_id": transportation_id,
                    "confidence": 0.96,
                }
            ],
            "min_confidence": 0.85,
        }
        first = client.post("/api/categorization/apply", json=payload)
        assert first.status_code == 200
        assert first.json()["applied_count"] == 1

        second = client.post("/api/categorization/apply", json=payload)
        assert second.status_code == 200
        assert second.json()["applied_count"] == 0
        assert second.json()["skipped_reasons"]["already_categorized"] == 1
    finally:
        settings.auto_categorization = False


def test_reason_and_confidence_present_and_valid_ranges(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    try:
        transportation_id = db_session.execute(
            select(Category.id).where(Category.name == "Transportation")
        ).scalar_one()
        txns = db_session.execute(select(Transaction).limit(3)).scalars().all()
        txns[0].description_norm = "RECURRING CAFE ORDER"
        txns[0].category_id = transportation_id
        txns[0].manual_category_override = False
        txns[1].description_norm = "RECURRING CAFE ORDER"
        txns[1].category_id = transportation_id
        txns[1].manual_category_override = False
        txns[2].description_norm = "RECURRING CAFE ORDER"
        txns[2].category_id = None
        txns[2].manual_category_override = False
        db_session.commit()

        resp = client.post(
            "/api/categorization/suggest",
            json={"start": "2026-01-01", "end": "2026-12-31"},
        )
        assert resp.status_code == 200
        suggestions = resp.json()["suggestions"]
        assert suggestions
        for row in suggestions:
            assert isinstance(row["reason"], str)
            assert row["reason"].strip()
            assert 0.0 <= float(row["confidence"]) <= 1.0
    finally:
        settings.auto_categorization = False


def test_similarity_fallback_does_not_return_nonsense_when_sparse_data(client, db_session: Session):
    _claim_and_sync(client)
    settings.auto_categorization = True
    previous_rule_state: dict[int, bool] = {}
    try:
        txns = db_session.execute(select(Transaction)).scalars().all()
        for txn in txns:
            txn.category_id = None
            txn.manual_category_override = False
            txn.description_norm = f"UNIQUE_{txn.id[:8]}"
        rules = db_session.execute(select(ClassificationRule)).scalars().all()
        previous_rule_state = {rule.id: rule.is_active for rule in rules}
        for rule in rules:
            rule.is_active = False
        db_session.commit()

        resp = client.post(
            "/api/categorization/suggest",
            json={"start": "2026-01-01", "end": "2026-12-31"},
        )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] == []
    finally:
        for rule in db_session.execute(select(ClassificationRule)).scalars():
            rule.is_active = previous_rule_state.get(rule.id, rule.is_active)
        db_session.commit()
        settings.auto_categorization = False
