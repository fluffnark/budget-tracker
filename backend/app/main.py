from __future__ import annotations

import logging
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile
from datetime import date, datetime, timedelta

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.orm import Session

from app.bootstrap import ensure_seed_data
from app.config import settings
from app.db import SessionLocal, get_db
from app.deps import get_current_owner
from app.middleware import SecretScrubMiddleware
from app.models import (
    Account,
    AppSetting,
    AuditLog,
    BalanceSnapshot,
    Category,
    ClassificationRule,
    Connection,
    Merchant,
    Owner,
    Transaction,
)
from app.scheduler import (
    schedule_daily_sync,
    schedule_email_report,
    start_scheduler,
    stop_scheduler,
)
from app.schemas import (
    AccountResponse,
    AuthSetupRequest,
    AuthStatusResponse,
    AdvisorEmailPreviewRequest,
    AdvisorEmailPreviewResponse,
    AdvisorEmailSendRequest,
    AdvisorEmailSendResponse,
    AdvisorReportGenerateRequest,
    AdvisorReportGenerateResponse,
    BudgetMonthPatchRequest,
    BudgetMonthResponse,
    BudgetPeriodResponse,
    BudgetRecurringResponse,
    CategorizationApplyRequest,
    CategorizationApplyResponse,
    CategorizationImportLLMRequest,
    CategorizationImportLLMResponse,
    CategorizationSuggestRequest,
    CategorizationSuggestResponse,
    CategoryCreateRequest,
    CategoryPatchRequest,
    CategoryResponse,
    ClaimSimplefinRequest,
    EmailReportSendResponse,
    ExportResponse,
    LoginRequest,
    LoginResponse,
    OwnerEmailChangeRequest,
    PasswordChangeRequest,
    RuleCreateRequest,
    RuleCreateResponse,
    RulePreviewRequest,
    RulePreviewResponse,
    RuleResponse,
    SankeyResponse,
    SheetsExportResponse,
    SettingsPatchRequest,
    SettingsResponse,
    SyncRunRequest,
    TransactionPatchRequest,
    TransactionResponse,
)
from app.services.advisor_reports import (
    build_advisor_email,
    generate_advisor_bundle,
    send_advisor_email,
)
from app.security import (
    create_session_cookie,
    encrypt_access_url,
    hash_password,
    read_session_cookie,
    verify_password,
)
from app.services.auto_categorization import apply_suggestions, suggest_for_range
from app.services.budgeting import (
    get_budget_month_snapshot,
    get_budget_period_summary,
    get_recurring_payment_candidates,
    save_budget_month_snapshot,
)
from app.services.categorization_suggest import suggest_categories
from app.services.exporter import build_llm_export, build_sheets_export, build_sheets_xlsx
from app.services.email_reports import send_monthly_email_report, set_smtp_password
from app.services.ingest import SyncError, run_sync
from app.services.reports import (
    balance_trends_data,
    mortgage_activity_data,
    mortgage_projection_data,
    monthly_report,
    projection_data,
    sankey_data,
    weekly_report,
    yearly_report,
)
from app.services.rules import ProposedRule, apply_new_rule, preview_rule_matches
from app.services.simplefin import SimplefinError, claim_access_url
from app.services.sync_progress import complete, fail, snapshot, start, update

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

app = FastAPI(title="Budget Tracker API")
app.add_middleware(SecretScrubMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://harmony.local:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    db = SessionLocal()
    try:
        ensure_seed_data(db)
    finally:
        db.close()
    if not settings.testing:
        start_scheduler(settings.sync_daily_hour, settings.sync_daily_minute)


@app.on_event("shutdown")
def on_shutdown() -> None:
    if not settings.testing:
        stop_scheduler()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "mock_mode": settings.simplefin_mock}


def _auth_status_payload(
    db: Session,
    *,
    owner: Owner | None = None,
    session_cookie: str | None = None,
) -> AuthStatusResponse:
    resolved_owner = owner or db.execute(select(Owner).limit(1)).scalar_one_or_none()
    connection = db.execute(
        select(Connection).where(Connection.kind == "simplefin").limit(1)
    ).scalar_one_or_none()
    authenticated = False
    if session_cookie:
        owner_id = read_session_cookie(session_cookie)
        authenticated = bool(
            owner_id and resolved_owner is not None and resolved_owner.id == owner_id
        )
    return AuthStatusResponse(
        is_setup=resolved_owner is not None,
        is_authenticated=authenticated,
        owner_email=resolved_owner.email if resolved_owner else None,
        simplefin_connected=connection is not None,
        simplefin_status=connection.status if connection else None,
    )


def _validate_new_password(password: str) -> str:
    candidate = password.strip()
    if len(candidate) < 10:
        raise HTTPException(status_code=400, detail="Password must be at least 10 characters")
    return candidate


@app.get("/api/auth/status", response_model=AuthStatusResponse)
def auth_status(
    session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> AuthStatusResponse:
    return _auth_status_payload(db, session_cookie=session)


@app.post("/api/auth/setup", response_model=LoginResponse)
def setup_owner(
    payload: AuthSetupRequest, response: Response, db: Session = Depends(get_db)
) -> LoginResponse:
    existing = db.execute(select(Owner).limit(1)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Initial setup already completed")

    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    password = _validate_new_password(payload.password)

    owner = Owner(id=1, email=email, password_hash=hash_password(password))
    db.add(owner)
    db.commit()
    db.refresh(owner)

    cookie = create_session_cookie(owner.id)
    response.set_cookie(
        key="session",
        value=cookie,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 30,
    )
    return LoginResponse(email=owner.email)


@app.post("/api/auth/login", response_model=LoginResponse)
def login(
    payload: LoginRequest, response: Response, db: Session = Depends(get_db)
) -> LoginResponse:
    owner = db.execute(select(Owner).limit(1)).scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=409, detail="Initial setup required")
    if owner.email != payload.email.strip().lower() or not verify_password(
        payload.password, owner.password_hash
    ):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    cookie = create_session_cookie(owner.id)
    response.set_cookie(
        key="session",
        value=cookie,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 30,
    )
    return LoginResponse(email=owner.email)


@app.post("/api/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("session")
    return {"ok": True}


@app.post("/api/auth/change-password")
def change_password(
    payload: PasswordChangeRequest,
    owner: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(payload.current_password, owner.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    owner.password_hash = hash_password(_validate_new_password(payload.new_password))
    db.commit()
    return {"ok": True}


@app.post("/api/auth/change-email", response_model=LoginResponse)
def change_email(
    payload: OwnerEmailChangeRequest,
    owner: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> LoginResponse:
    if not verify_password(payload.current_password, owner.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    existing = db.execute(
        select(Owner).where(Owner.email == email, Owner.id != owner.id)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email is already in use")

    owner.email = email
    db.commit()
    db.refresh(owner)
    return LoginResponse(email=owner.email)


@app.get("/api/accounts", response_model=list[AccountResponse])
def get_accounts(
    include_inactive: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> list[AccountResponse]:
    latest_balance_subq = (
        select(
            BalanceSnapshot.account_id,
            func.max(BalanceSnapshot.id).label("latest_snapshot_id"),
        )
        .group_by(BalanceSnapshot.account_id)
        .subquery()
    )

    query = (
        select(Account, BalanceSnapshot, Connection)
        .outerjoin(
            latest_balance_subq,
            latest_balance_subq.c.account_id == Account.id,
        )
        .outerjoin(
            BalanceSnapshot,
            and_(
                BalanceSnapshot.account_id == Account.id,
                BalanceSnapshot.id == latest_balance_subq.c.latest_snapshot_id,
            ),
        )
        .outerjoin(Connection, Connection.kind == "simplefin")
        .order_by(Account.name.asc())
    )

    if not include_inactive:
        query = query.where(Account.is_active.is_(True))

    rows = db.execute(query).all()

    output: list[AccountResponse] = []
    for account, snapshot, connection in rows:
        output.append(
            AccountResponse(
                id=account.id,
                institution_name=account.institution.name if account.institution else None,
                name=account.name,
                type=account.type,
                currency=account.currency,
                source_type=account.source_type,
                is_active=account.is_active,
                balance=float(snapshot.balance) if snapshot else None,
                available_balance=(
                    float(snapshot.available_balance)
                    if snapshot and snapshot.available_balance is not None
                    else None
                ),
                last_sync_at=connection.last_sync_at if connection else None,
            )
        )
    return output


@app.get("/api/transactions", response_model=list[TransactionResponse])
def get_transactions(
    start: date | None = None,
    end: date | None = None,
    account_id: str | None = None,
    category_id: int | None = None,
    q: str | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
    include_pending: bool = True,
    include_transfers: bool = True,
    limit: int = Query(default=200, le=500),
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> list[TransactionResponse]:
    query = (
        select(Transaction, Account, Category, Merchant)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
    )

    if start:
        query = query.where(Transaction.posted_at >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.where(
            Transaction.posted_at < datetime.combine(end + timedelta(days=1), datetime.min.time())
        )
    if account_id:
        query = query.where(Transaction.account_id == account_id)
    if category_id:
        query = query.where(Transaction.category_id == category_id)
    if q:
        token = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(Transaction.description_raw).like(token),
                func.lower(Transaction.description_norm).like(token),
            )
        )
    if min_amount is not None:
        query = query.where(func.abs(Transaction.amount) >= min_amount)
    if max_amount is not None:
        query = query.where(func.abs(Transaction.amount) <= max_amount)
    if not include_pending:
        query = query.where(Transaction.is_pending.is_(False))
    if not include_transfers:
        query = query.where(
            and_(
                Transaction.transfer_id.is_(None),
                or_(Category.system_kind.is_(None), Category.system_kind != "transfer"),
            )
        )

    rows = db.execute(query.order_by(desc(Transaction.posted_at)).limit(limit)).all()

    return [
        TransactionResponse(
            id=txn.id,
            account_id=account.id,
            account_name=account.name,
            account_type=account.type,
            posted_at=txn.posted_at,
            amount=float(txn.amount),
            currency=txn.currency,
            description_raw=txn.description_raw,
            description_norm=txn.description_norm,
            is_pending=txn.is_pending,
            category_id=txn.category_id,
            category_name=category.name if category else None,
            merchant_id=txn.merchant_id,
            merchant_name=merchant.name_canonical if merchant else None,
            transfer_id=txn.transfer_id,
            notes=txn.notes,
            manual_category_override=txn.manual_category_override,
        )
        for txn, account, category, merchant in rows
    ]


@app.patch("/api/transactions/{txn_id}", response_model=TransactionResponse)
def patch_transaction(
    txn_id: str,
    payload: TransactionPatchRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    row = db.execute(
        select(Transaction, Account, Category, Merchant)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
        .where(Transaction.id == txn_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found")

    txn, account, category, merchant = row
    before = {
        "category_id": txn.category_id,
        "merchant_id": txn.merchant_id,
        "notes": txn.notes,
        "is_pending": txn.is_pending,
        "manual_category_override": txn.manual_category_override,
    }

    if payload.category_id is not None:
        txn.category_id = payload.category_id
        txn.manual_category_override = True
    elif "category_id" in payload.model_fields_set:
        txn.category_id = None
        txn.manual_category_override = False
    if payload.merchant_id is not None:
        txn.merchant_id = payload.merchant_id
    if payload.notes is not None:
        txn.notes = payload.notes
    if payload.is_pending is not None:
        txn.is_pending = payload.is_pending

    after = {
        "category_id": txn.category_id,
        "merchant_id": txn.merchant_id,
        "notes": txn.notes,
        "is_pending": txn.is_pending,
        "manual_category_override": txn.manual_category_override,
    }
    db.add(
        AuditLog(
            action_type="update",
            entity_type="transaction",
            entity_id=txn.id,
            before=before,
            after=after,
        )
    )
    db.commit()
    db.refresh(txn)

    category = db.execute(
        select(Category).where(Category.id == txn.category_id)
    ).scalar_one_or_none()
    merchant = db.execute(
        select(Merchant).where(Merchant.id == txn.merchant_id)
    ).scalar_one_or_none()

    return TransactionResponse(
        id=txn.id,
        account_id=account.id,
        account_name=account.name,
        account_type=account.type,
        posted_at=txn.posted_at,
        amount=float(txn.amount),
        currency=txn.currency,
        description_raw=txn.description_raw,
        description_norm=txn.description_norm,
        is_pending=txn.is_pending,
        category_id=txn.category_id,
        category_name=category.name if category else None,
        merchant_id=txn.merchant_id,
        merchant_name=merchant.name_canonical if merchant else None,
        transfer_id=txn.transfer_id,
        notes=txn.notes,
        manual_category_override=txn.manual_category_override,
    )


@app.post("/api/rules/preview", response_model=RulePreviewResponse)
def preview_rule(
    payload: RulePreviewRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> RulePreviewResponse:
    proposed = ProposedRule(
        priority=payload.priority,
        match_type=payload.match_type,
        pattern=payload.pattern,
        category_id=payload.category_id,
        merchant_override_id=payload.merchant_override_id,
        is_active=payload.is_active,
    )
    match_count, sample_ids = preview_rule_matches(db, proposed)
    return RulePreviewResponse(match_count=match_count, sample_transaction_ids=sample_ids)


@app.post("/api/rules", response_model=RuleCreateResponse)
def create_rule(
    payload: RuleCreateRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> RuleCreateResponse:
    rule = ClassificationRule(
        priority=payload.priority,
        match_type=payload.match_type,
        pattern=payload.pattern,
        category_id=payload.category_id,
        merchant_override_id=payload.merchant_override_id,
        is_active=payload.is_active,
    )
    db.add(rule)
    db.flush()
    applied_count, sample_ids = apply_new_rule(db, rule)
    db.commit()
    db.refresh(rule)
    return RuleCreateResponse(
        **RuleResponse.model_validate(rule, from_attributes=True).model_dump(),
        match_count=applied_count,
        sample_transaction_ids=sample_ids,
    )


@app.get("/api/rules", response_model=list[RuleResponse])
def get_rules(
    _: Owner = Depends(get_current_owner), db: Session = Depends(get_db)
) -> list[RuleResponse]:
    rules = (
        db.execute(select(ClassificationRule).order_by(ClassificationRule.priority.asc()))
        .scalars()
        .all()
    )
    return [RuleResponse.model_validate(rule, from_attributes=True) for rule in rules]


@app.delete("/api/rules/{rule_id}")
def delete_rule(
    rule_id: int, _: Owner = Depends(get_current_owner), db: Session = Depends(get_db)
) -> dict:
    rule = db.execute(
        select(ClassificationRule).where(ClassificationRule.id == rule_id)
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@app.post("/api/simplefin/claim")
def claim_simplefin(
    payload: ClaimSimplefinRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    try:
        access_url = claim_access_url(payload.setup_token)
    except (SimplefinError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    encrypted = encrypt_access_url(access_url)
    connection = db.execute(
        select(Connection).where(Connection.kind == "simplefin")
    ).scalar_one_or_none()
    if connection is None:
        connection = Connection(kind="simplefin", access_url_encrypted=encrypted, status="ok")
        db.add(connection)
    else:
        connection.access_url_encrypted = encrypted
        connection.status = "ok"
    db.commit()
    return {"ok": True, "status": connection.status}


@app.post("/api/sync/run")
def trigger_sync(
    payload: SyncRunRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    mode = "backfill" if payload.force_backfill else "sync"
    start(mode=mode)
    try:
        result = run_sync(
            db,
            balances_only=payload.balances_only,
            force_backfill=payload.force_backfill,
            progress_callback=lambda current, total, message: update(
                current_window=current, total_windows=total, message=message
            ),
        )
        complete(result=result)
        return result
    except SyncError as exc:
        fail(error=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SimplefinError as exc:
        fail(error=str(exc))
        connection = db.execute(
            select(Connection).where(Connection.kind == "simplefin")
        ).scalar_one_or_none()
        if connection:
            connection.status = "error"
            db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        fail(error=str(exc))
        raise


@app.get("/api/sync/status")
def get_sync_status(
    _: Owner = Depends(get_current_owner),
) -> dict:
    return snapshot()


@app.get("/api/reports/weekly")
def get_weekly_report(
    start: date,
    end: date,
    include_pending: bool = True,
    include_transfers: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return weekly_report(
        db,
        start=start,
        end=end,
        include_pending=include_pending,
        include_transfers=include_transfers,
    )


@app.get("/api/reports/monthly")
def get_monthly_report(
    year: int,
    month: int,
    include_pending: bool = True,
    include_transfers: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return monthly_report(
        db,
        year=year,
        month=month,
        include_pending=include_pending,
        include_transfers=include_transfers,
    )


@app.get("/api/reports/yearly")
def get_yearly_report(
    year: int,
    include_pending: bool = True,
    include_transfers: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return yearly_report(
        db, year=year, include_pending=include_pending, include_transfers=include_transfers
    )


@app.get("/api/budget/month", response_model=BudgetMonthResponse)
def get_budget_month(
    month: date,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> BudgetMonthResponse:
    return BudgetMonthResponse.model_validate(get_budget_month_snapshot(db, month))


@app.put("/api/budget/month", response_model=BudgetMonthResponse)
def put_budget_month(
    payload: BudgetMonthPatchRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> BudgetMonthResponse:
    return BudgetMonthResponse.model_validate(
        save_budget_month_snapshot(
            db,
            month=payload.month_start,
            income_target=payload.income_target,
            starting_cash=payload.starting_cash,
            planned_savings=payload.planned_savings,
            leftover_strategy=payload.leftover_strategy,
            rows=[item.model_dump() for item in payload.rows],
        )
    )


@app.get("/api/budget/period", response_model=BudgetPeriodResponse)
def get_budget_period(
    period: str = Query(default="monthly"),
    anchor: date | None = None,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> BudgetPeriodResponse:
    if period not in {"weekly", "monthly", "yearly"}:
        raise HTTPException(status_code=400, detail="Unsupported budget period")
    resolved_anchor = anchor or datetime.now().date()
    return BudgetPeriodResponse.model_validate(
        get_budget_period_summary(db, period=period, anchor=resolved_anchor)
    )


@app.get("/api/budget/recurring", response_model=BudgetRecurringResponse)
def get_budget_recurring(
    anchor: date | None = None,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> BudgetRecurringResponse:
    resolved_anchor = anchor or datetime.now().date()
    return BudgetRecurringResponse.model_validate(
        get_recurring_payment_candidates(db, anchor=resolved_anchor)
    )


@app.get("/api/analytics/sankey", response_model=SankeyResponse)
def get_sankey(
    start: date,
    end: date,
    include_pending: bool = True,
    include_transfers: bool = False,
    mode: str = Query(default="account_to_grouped_category"),
    category_ids: list[int] | None = Query(default=None),
    max_categories_per_group: int = Query(default=6, ge=1, le=20),
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> SankeyResponse:
    if mode not in {
        "account_to_grouped_category",
        "account_to_category",
        "category_to_account",
        "income_hub_outcomes",
    }:
        raise HTTPException(status_code=400, detail="Unsupported sankey mode")

    return SankeyResponse.model_validate(
        sankey_data(
            db,
            start=start,
            end=end,
            include_pending=include_pending,
            include_transfers=include_transfers,
            mode=mode,
            category_ids=category_ids,
            max_categories_per_group=max_categories_per_group,
        )
    )


@app.get("/api/analytics/projections")
def get_projections(
    utility_inflation_rate: float = 0.0,
    general_inflation_rate: float = 0.0,
    savings_apr: float = 0.0,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return projection_data(
        db,
        utility_inflation_rate=utility_inflation_rate,
        general_inflation_rate=general_inflation_rate,
        savings_apr=savings_apr,
    )


@app.get("/api/analytics/balance_trends")
def get_balance_trends(
    start: date,
    end: date,
    include_inactive: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return balance_trends_data(
        db,
        start=start,
        end=end,
        include_inactive=include_inactive,
    )


@app.get("/api/analytics/mortgage_projection")
def get_mortgage_projection(
    principal_balance: float,
    annual_interest_rate: float,
    years_remaining: int,
    monthly_payment: float | None = None,
    extra_payment: float = 0.0,
    months_to_project: int = 360,
    _: Owner = Depends(get_current_owner),
) -> dict:
    return mortgage_projection_data(
        principal_balance=principal_balance,
        annual_interest_rate=annual_interest_rate,
        years_remaining=years_remaining,
        monthly_payment=monthly_payment,
        extra_payment=extra_payment,
        months_to_project=months_to_project,
    )


@app.get("/api/analytics/mortgage_activity")
def get_mortgage_activity(
    account_id: str,
    start: date,
    end: date,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    return mortgage_activity_data(db, account_id=account_id, start=start, end=end)


@app.get("/api/categorization/suggestions")
def get_categorization_suggestions(
    start: date,
    end: date,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> list[dict]:
    if not settings.categorization_suggestions:
        raise HTTPException(
            status_code=404, detail="Categorization suggestions feature is disabled"
        )
    return suggest_categories(db, start=start, end=end)


@app.post("/api/categorization/suggest", response_model=CategorizationSuggestResponse)
def suggest_categorization(
    payload: CategorizationSuggestRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> CategorizationSuggestResponse:
    if not settings.auto_categorization:
        raise HTTPException(status_code=404, detail="Auto-categorization is disabled")

    suggestions = suggest_for_range(
        db,
        start=payload.start,
        end=payload.end,
        account_ids=payload.account_ids,
        include_pending=payload.include_pending,
        include_transfers=payload.include_transfers,
        max_suggestions=payload.max_suggestions,
    )
    return CategorizationSuggestResponse(
        suggestions=[
            {
                "transaction_id": row.transaction_id,
                "suggested_category_id": row.suggested_category_id,
                "confidence": row.confidence,
                "reason": row.reason,
                "category_path": row.category_path,
            }
            for row in suggestions
        ]
    )


@app.post("/api/categorization/apply", response_model=CategorizationApplyResponse)
def apply_categorization(
    payload: CategorizationApplyRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> CategorizationApplyResponse:
    if not settings.auto_categorization:
        raise HTTPException(status_code=404, detail="Auto-categorization is disabled")

    applied_count, skipped_count, skipped_reasons = apply_suggestions(
        db,
        suggestions=[item.model_dump() for item in payload.suggestions],
        min_confidence=payload.min_confidence,
        include_pending=payload.include_pending,
        allow_transfers=payload.allow_transfers,
        dry_run=payload.dry_run,
    )
    return CategorizationApplyResponse(
        applied_count=applied_count,
        skipped_count=skipped_count,
        skipped_reasons=skipped_reasons,
    )


@app.post("/api/categorization/import_llm", response_model=CategorizationImportLLMResponse)
def import_categorization_from_llm(
    payload: CategorizationImportLLMRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> CategorizationImportLLMResponse:
    if not settings.auto_categorization:
        raise HTTPException(status_code=404, detail="Auto-categorization is disabled")

    applied_count, skipped_count, skipped_reasons = apply_suggestions(
        db,
        suggestions=[
            {
                "transaction_id": item.transaction_id,
                "suggested_category_id": item.category_id,
                "confidence": 1.0,
            }
            for item in payload.proposed_assignments
        ],
        min_confidence=payload.min_confidence,
        include_pending=payload.include_pending,
        allow_transfers=payload.allow_transfers,
        dry_run=False,
    )

    rules_created = 0
    rules_applied_count = 0
    if payload.apply_rules and payload.proposed_rules:
        for item in payload.proposed_rules:
            rule = ClassificationRule(
                priority=item.priority,
                match_type=item.match_type,
                pattern=item.pattern,
                category_id=item.category_id,
                merchant_override_id=None,
                is_active=True,
            )
            db.add(rule)
            db.flush()
            changed, _sample_ids = apply_new_rule(db, rule)
            rules_created += 1
            rules_applied_count += changed
        db.commit()

    return CategorizationImportLLMResponse(
        applied_count=applied_count,
        skipped_count=skipped_count,
        skipped_reasons=skipped_reasons,
        rules_created=rules_created,
        rules_applied_count=rules_applied_count,
    )


@app.get("/api/export/llm", response_model=ExportResponse)
def export_llm(
    start: date,
    end: date,
    scrub: bool = True,
    hash_merchants: bool = True,
    round_amounts: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> ExportResponse:
    payload = build_llm_export(
        db,
        start=start,
        end=end,
        scrub=scrub,
        hash_merchants=hash_merchants,
        round_amounts=round_amounts,
    )
    prompt = payload.pop("prompt_template")
    return ExportResponse(payload=payload, prompt_template=prompt)


@app.get("/api/export/sheets", response_model=SheetsExportResponse)
def export_sheets(
    start: date,
    end: date,
    scrub: bool = True,
    hash_merchants: bool = True,
    round_amounts: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> SheetsExportResponse:
    return SheetsExportResponse.model_validate(
        build_sheets_export(
            db,
            start=start,
            end=end,
            scrub=scrub,
            hash_merchants=hash_merchants,
            round_amounts=round_amounts,
        )
    )


@app.get("/api/export/sheets.zip")
def export_sheets_zip(
    start: date,
    end: date,
    scrub: bool = True,
    hash_merchants: bool = True,
    round_amounts: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    workbook = build_sheets_export(
        db,
        start=start,
        end=end,
        scrub=scrub,
        hash_merchants=hash_merchants,
        round_amounts=round_amounts,
    )

    def quote_csv_cell(value: object | None) -> str:
        if value is None:
            return ""
        text = str(value)
        if any(char in text for char in [",", "\"", "\n"]):
            return f"\"{text.replace('\"', '\"\"')}\""
        return text

    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        for sheet in workbook["sheets"]:
            rows = [sheet["columns"], *sheet["rows"]]
            contents = "\n".join(
                ",".join(quote_csv_cell(cell) for cell in row) for row in rows
            )
            archive.writestr(f"{sheet['name']}.csv", contents)

    buffer.seek(0)
    filename = f"{workbook['workbook_name']}.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/export/sheets.xlsx")
def export_sheets_xlsx(
    start: date,
    end: date,
    scrub: bool = True,
    hash_merchants: bool = True,
    round_amounts: bool = False,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    workbook = build_sheets_export(
        db,
        start=start,
        end=end,
        scrub=scrub,
        hash_merchants=hash_merchants,
        round_amounts=round_amounts,
    )
    xlsx_bytes = build_sheets_xlsx(workbook)
    filename = f"{workbook['workbook_name']}.xlsx"
    return StreamingResponse(
        BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/settings", response_model=SettingsResponse)
def get_settings(
    _: Owner = Depends(get_current_owner), db: Session = Depends(get_db)
) -> SettingsResponse:
    return _read_settings(db)


def _read_settings(db: Session) -> SettingsResponse:
    values = {
        row.key: row.value
        for row in db.execute(
            select(AppSetting).where(
                AppSetting.key.in_(
                    [
                        "sync_daily_hour",
                        "sync_daily_minute",
                        "scrub_default",
                        "email_reports_enabled",
                        "email_report_day",
                        "email_report_hour",
                        "email_report_minute",
                        "email_report_recipients",
                        "smtp_host",
                        "smtp_port",
                        "smtp_username",
                        "smtp_from",
                        "smtp_use_tls",
                        "smtp_use_ssl",
                        "smtp_password_encrypted",
                    ]
                )
            )
        ).scalars()
    }
    hour = int(values.get("sync_daily_hour", settings.sync_daily_hour))
    minute = int(values.get("sync_daily_minute", settings.sync_daily_minute))
    scrub_default = values.get("scrub_default", "1") == "1"
    return SettingsResponse(
        sync_daily_hour=hour,
        sync_daily_minute=minute,
        simplefin_mock=settings.simplefin_mock,
        scrub_default=scrub_default,
        auto_categorization=settings.auto_categorization,
        email_reports_enabled=values.get("email_reports_enabled", "0") == "1",
        email_report_day=int(values.get("email_report_day", "1")),
        email_report_hour=int(values.get("email_report_hour", "12")),
        email_report_minute=int(values.get("email_report_minute", "0")),
        email_report_recipients=values.get("email_report_recipients", ""),
        smtp_host=values.get("smtp_host", ""),
        smtp_port=int(values.get("smtp_port", "587")),
        smtp_username=values.get("smtp_username", ""),
        smtp_from=values.get("smtp_from", ""),
        smtp_use_tls=values.get("smtp_use_tls", "1") == "1",
        smtp_use_ssl=values.get("smtp_use_ssl", "0") == "1",
        smtp_password_set=bool(values.get("smtp_password_encrypted", "").strip()),
    )


@app.patch("/api/settings", response_model=SettingsResponse)
def patch_settings(
    payload: SettingsPatchRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> SettingsResponse:
    updates: dict[str, str] = {}
    if payload.sync_daily_hour is not None:
        updates["sync_daily_hour"] = str(payload.sync_daily_hour)
    if payload.sync_daily_minute is not None:
        updates["sync_daily_minute"] = str(payload.sync_daily_minute)
    if payload.scrub_default is not None:
        updates["scrub_default"] = "1" if payload.scrub_default else "0"
    if payload.email_reports_enabled is not None:
        updates["email_reports_enabled"] = "1" if payload.email_reports_enabled else "0"
    if payload.email_report_day is not None:
        updates["email_report_day"] = str(payload.email_report_day)
    if payload.email_report_hour is not None:
        updates["email_report_hour"] = str(payload.email_report_hour)
    if payload.email_report_minute is not None:
        updates["email_report_minute"] = str(payload.email_report_minute)
    if payload.email_report_recipients is not None:
        updates["email_report_recipients"] = payload.email_report_recipients
    if payload.smtp_host is not None:
        updates["smtp_host"] = payload.smtp_host
    if payload.smtp_port is not None:
        updates["smtp_port"] = str(payload.smtp_port)
    if payload.smtp_username is not None:
        updates["smtp_username"] = payload.smtp_username
    if payload.smtp_from is not None:
        updates["smtp_from"] = payload.smtp_from
    if payload.smtp_use_tls is not None:
        updates["smtp_use_tls"] = "1" if payload.smtp_use_tls else "0"
    if payload.smtp_use_ssl is not None:
        updates["smtp_use_ssl"] = "1" if payload.smtp_use_ssl else "0"

    for key, value in updates.items():
        setting = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
        if setting is None:
            setting = AppSetting(key=key, value=value)
            db.add(setting)
        else:
            setting.value = value

    if payload.smtp_password is not None and payload.smtp_password.strip():
        set_smtp_password(db, payload.smtp_password.strip())

    db.commit()

    if "sync_daily_hour" in updates or "sync_daily_minute" in updates:
        current = _read_settings(db)
        hour = current.sync_daily_hour
        minute = current.sync_daily_minute
        schedule_daily_sync(hour, minute)
    if any(
        key in updates
        for key in [
            "email_reports_enabled",
            "email_report_day",
            "email_report_hour",
            "email_report_minute",
        ]
    ):
        schedule_email_report()

    return _read_settings(db)


@app.post("/api/email/report/send", response_model=EmailReportSendResponse)
def send_email_report_now(
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> EmailReportSendResponse:
    result = send_monthly_email_report(db, force_send=True)
    return EmailReportSendResponse(**result)


@app.post("/api/advisor/report/generate", response_model=AdvisorReportGenerateResponse)
def generate_advisor_report(
    payload: AdvisorReportGenerateRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> AdvisorReportGenerateResponse:
    bundle = generate_advisor_bundle(
        db,
        days=payload.days,
        end_date=payload.end_date,
        include_pending=payload.include_pending,
        include_transfers=payload.include_transfers,
        hash_merchants=payload.hash_merchants,
        round_amounts=payload.round_amounts,
    )
    return AdvisorReportGenerateResponse(
        start=bundle.start.isoformat(),
        end=bundle.end.isoformat(),
        days=bundle.days,
        stats=bundle.stats,
        charts=bundle.charts,
        scrubbed_payload=bundle.scrubbed_payload,
        prompt_markdown=bundle.prompt_markdown,
    )


@app.post("/api/advisor/report/email/preview", response_model=AdvisorEmailPreviewResponse)
def preview_advisor_email(
    payload: AdvisorEmailPreviewRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> AdvisorEmailPreviewResponse:
    bundle = generate_advisor_bundle(
        db,
        days=payload.days,
        end_date=payload.end_date,
        include_pending=payload.include_pending,
        include_transfers=payload.include_transfers,
        hash_merchants=payload.hash_merchants,
        round_amounts=payload.round_amounts,
    )
    email_parts = build_advisor_email(bundle=bundle, advisor_response=payload.advisor_response)
    recipients = (
        payload.recipients
        if payload.recipients is not None
        else _read_settings(db).email_report_recipients
    )
    return AdvisorEmailPreviewResponse(
        subject=email_parts["subject"],
        recipients=recipients,
        markdown_body=email_parts["markdown"],
        html_body=email_parts["html"],
        start=bundle.start.isoformat(),
        end=bundle.end.isoformat(),
        days=bundle.days,
        stats=bundle.stats,
        charts=bundle.charts,
    )


@app.post("/api/advisor/report/email/send", response_model=AdvisorEmailSendResponse)
def send_advisor_report_email(
    payload: AdvisorEmailSendRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> AdvisorEmailSendResponse:
    bundle = generate_advisor_bundle(
        db,
        days=payload.days,
        end_date=payload.end_date,
        include_pending=payload.include_pending,
        include_transfers=payload.include_transfers,
        hash_merchants=payload.hash_merchants,
        round_amounts=payload.round_amounts,
    )
    email_parts = build_advisor_email(bundle=bundle, advisor_response=payload.advisor_response)
    recipients = (
        payload.recipients
        if payload.recipients is not None
        else _read_settings(db).email_report_recipients
    )
    result = send_advisor_email(
        db,
        recipients_csv=recipients,
        subject=email_parts["subject"],
        markdown_body=email_parts["markdown"],
        html_body=email_parts["html"],
    )
    return AdvisorEmailSendResponse(
        sent=result["sent"],
        reason=result.get("reason"),
        subject=email_parts["subject"],
        recipients=recipients,
        recipient_count=result.get("recipient_count", 0),
        start=bundle.start.isoformat(),
        end=bundle.end.isoformat(),
    )


def _serialize_category(category: Category) -> CategoryResponse:
    return CategoryResponse(
        id=category.id,
        parent_id=category.parent_id,
        name=category.name,
        system_kind=category.system_kind,
        color=category.color,
        icon=category.icon,
    )


def _category_name_exists(db: Session, name: str, *, skip_id: int | None = None) -> bool:
    q = select(Category).where(func.lower(Category.name) == name.strip().lower())
    if skip_id is not None:
        q = q.where(Category.id != skip_id)
    return db.execute(q).scalar_one_or_none() is not None


def _validate_parent(
    db: Session, *, category_id: int | None, parent_id: int | None
) -> Category | None:
    if parent_id is None:
        return None
    if category_id is not None and parent_id == category_id:
        raise HTTPException(status_code=400, detail="Category cannot be its own parent")
    parent = db.execute(select(Category).where(Category.id == parent_id)).scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent category not found")

    if category_id is not None:
        # Cycle guard: walk up ancestry from requested parent.
        seen: set[int] = set()
        current = parent
        while current and current.id not in seen:
            if current.id == category_id:
                raise HTTPException(status_code=400, detail="Category parent cycle is not allowed")
            seen.add(current.id)
            if current.parent_id is None:
                break
            current = db.execute(
                select(Category).where(Category.id == current.parent_id)
            ).scalar_one_or_none()

    return parent


@app.get("/api/categories", response_model=list[CategoryResponse])
def get_categories(
    _: Owner = Depends(get_current_owner), db: Session = Depends(get_db)
) -> list[CategoryResponse]:
    categories = db.execute(
        select(Category).order_by(Category.parent_id.asc().nullsfirst(), Category.name.asc())
    ).scalars()
    return [_serialize_category(category) for category in categories]


@app.post("/api/categories", response_model=CategoryResponse)
def create_category(
    payload: CategoryCreateRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    name = payload.name.strip()
    if _category_name_exists(db, name):
        raise HTTPException(status_code=409, detail="Category name already exists")
    parent = _validate_parent(db, category_id=None, parent_id=payload.parent_id)
    category = Category(
        name=name,
        parent_id=parent.id if parent else None,
        system_kind=payload.system_kind,
        color=payload.color.strip() if payload.color else None,
        icon=payload.icon.strip() if payload.icon else None,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return _serialize_category(category)


@app.patch("/api/categories/{category_id}", response_model=CategoryResponse)
def patch_category(
    category_id: int,
    payload: CategoryPatchRequest,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> CategoryResponse:
    category = db.execute(select(Category).where(Category.id == category_id)).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if "name" in payload.model_fields_set and payload.name is not None:
        next_name = payload.name.strip()
        if _category_name_exists(db, next_name, skip_id=category.id):
            raise HTTPException(status_code=409, detail="Category name already exists")
        category.name = next_name
    if "system_kind" in payload.model_fields_set and payload.system_kind is not None:
        category.system_kind = payload.system_kind
    if "parent_id" in payload.model_fields_set:
        parent = _validate_parent(db, category_id=category.id, parent_id=payload.parent_id)
        category.parent_id = parent.id if parent else None
    if "color" in payload.model_fields_set:
        category.color = payload.color.strip() if payload.color else None
    if "icon" in payload.model_fields_set:
        category.icon = payload.icon.strip() if payload.icon else None

    db.commit()
    db.refresh(category)
    return _serialize_category(category)


@app.delete("/api/categories/{category_id}")
def delete_category(
    category_id: int,
    _: Owner = Depends(get_current_owner),
    db: Session = Depends(get_db),
) -> dict:
    category = db.execute(select(Category).where(Category.id == category_id)).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    child_exists = db.execute(
        select(Category.id).where(Category.parent_id == category_id).limit(1)
    ).scalar_one_or_none()
    if child_exists:
        raise HTTPException(status_code=409, detail="Remove child categories first")

    txn_exists = db.execute(
        select(Transaction.id).where(Transaction.category_id == category_id).limit(1)
    ).scalar_one_or_none()
    if txn_exists:
        raise HTTPException(status_code=409, detail="Category is used by transactions")

    rule_exists = db.execute(
        select(ClassificationRule.id).where(ClassificationRule.category_id == category_id).limit(1)
    ).scalar_one_or_none()
    if rule_exists:
        raise HTTPException(status_code=409, detail="Category is used by rules")

    db.delete(category)
    db.commit()
    return {"ok": True}
