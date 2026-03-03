from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    email: str


class ClaimSimplefinRequest(BaseModel):
    setup_token: str


class SyncRunRequest(BaseModel):
    balances_only: bool = False
    force_backfill: bool = False


class RuleCreateRequest(BaseModel):
    priority: int = 100
    match_type: str
    pattern: str | None = None
    category_id: int
    merchant_override_id: int | None = None
    is_active: bool = True


class RulePreviewRequest(BaseModel):
    priority: int = 100
    match_type: str
    pattern: str | None = None
    category_id: int
    merchant_override_id: int | None = None
    is_active: bool = True


class RulePreviewResponse(BaseModel):
    match_count: int
    sample_transaction_ids: list[str]


class RuleResponse(BaseModel):
    id: int
    priority: int
    match_type: str
    pattern: str | None
    category_id: int
    merchant_override_id: int | None
    is_active: bool


class RuleCreateResponse(RuleResponse):
    match_count: int
    sample_transaction_ids: list[str]


class CategorizationSuggestRequest(BaseModel):
    start: date
    end: date
    account_ids: list[str] | None = None
    include_pending: bool = True
    include_transfers: bool = False
    max_suggestions: int = 200


class CategorizationSuggestion(BaseModel):
    transaction_id: str
    suggested_category_id: int
    confidence: float
    reason: str
    category_path: str


class CategorizationSuggestResponse(BaseModel):
    suggestions: list[CategorizationSuggestion]


class CategorizationApplyItem(BaseModel):
    transaction_id: str
    suggested_category_id: int
    confidence: float = 1.0


class CategorizationApplyRequest(BaseModel):
    suggestions: list[CategorizationApplyItem]
    min_confidence: float = 0.85
    include_pending: bool = True
    allow_transfers: bool = False
    dry_run: bool = False


class CategorizationApplyResponse(BaseModel):
    applied_count: int
    skipped_count: int
    skipped_reasons: dict[str, int]


class LLMCategorizationAssignment(BaseModel):
    transaction_id: str
    category_id: int
    reason: str | None = None


class LLMCategorizationRule(BaseModel):
    match_type: str
    pattern: str
    category_id: int
    priority: int = 100
    reason: str | None = None


class CategorizationImportLLMRequest(BaseModel):
    proposed_assignments: list[LLMCategorizationAssignment]
    proposed_rules: list[LLMCategorizationRule] = []
    min_confidence: float = 0.0
    include_pending: bool = True
    allow_transfers: bool = False
    apply_rules: bool = False


class CategorizationImportLLMResponse(BaseModel):
    applied_count: int
    skipped_count: int
    skipped_reasons: dict[str, int]
    rules_created: int = 0
    rules_applied_count: int = 0


class TransactionPatchRequest(BaseModel):
    category_id: int | None = None
    merchant_id: int | None = None
    notes: str | None = None
    is_pending: bool | None = None


class TransactionResponse(BaseModel):
    id: str
    account_id: str
    account_name: str
    account_type: str
    posted_at: datetime
    amount: float
    currency: str
    description_raw: str
    description_norm: str
    is_pending: bool
    category_id: int | None
    category_name: str | None
    merchant_id: int | None
    merchant_name: str | None
    transfer_id: int | None
    notes: str | None
    manual_category_override: bool


class AccountResponse(BaseModel):
    id: str
    institution_name: str | None
    name: str
    type: str
    currency: str
    source_type: str
    is_active: bool
    balance: float | None
    available_balance: float | None
    last_sync_at: datetime | None


class ReportTotals(BaseModel):
    inflow: float
    outflow: float
    net: float


class WeeklyReportResponse(BaseModel):
    totals: ReportTotals
    top_categories: list[dict[str, Any]]
    largest_transactions: list[dict[str, Any]]
    utilities: list[dict[str, Any]]


class MonthlyReportResponse(BaseModel):
    totals: ReportTotals
    category_breakdown: list[dict[str, Any]]
    mom_deltas: list[dict[str, Any]]
    utilities: list[dict[str, Any]]


class YearlyReportResponse(BaseModel):
    year: int
    monthly_totals: list[dict[str, Any]]
    category_trends: list[dict[str, Any]]


class SankeyResponse(BaseModel):
    nodes: list[dict[str, Any]]
    links: list[dict[str, Any]]


class CategoryResponse(BaseModel):
    id: int
    parent_id: int | None
    name: str
    system_kind: str
    color: str | None = None
    icon: str | None = None


class CategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    system_kind: str = Field(pattern="^(income|expense|transfer|uncategorized)$")
    parent_id: int | None = None
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=50)


class CategoryPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    system_kind: str | None = Field(
        default=None, pattern="^(income|expense|transfer|uncategorized)$"
    )
    parent_id: int | None = None
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=50)


class TransferResponse(BaseModel):
    id: int
    txn_out_id: str
    txn_in_id: str
    confidence: float
    status: str
    created_at: datetime


class TransferPatchRequest(BaseModel):
    status: str = Field(pattern="^(confirmed|rejected|auto_confirmed|proposed)$")


class SettingsResponse(BaseModel):
    sync_daily_hour: int
    sync_daily_minute: int
    simplefin_mock: bool
    scrub_default: bool
    auto_categorization: bool
    email_reports_enabled: bool
    email_report_day: int
    email_report_hour: int
    email_report_minute: int
    email_report_recipients: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_from: str
    smtp_use_tls: bool
    smtp_use_ssl: bool
    smtp_password_set: bool


class SettingsPatchRequest(BaseModel):
    sync_daily_hour: int | None = None
    sync_daily_minute: int | None = None
    scrub_default: bool | None = None
    email_reports_enabled: bool | None = None
    email_report_day: int | None = None
    email_report_hour: int | None = None
    email_report_minute: int | None = None
    email_report_recipients: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_use_tls: bool | None = None
    smtp_use_ssl: bool | None = None


class ExportResponse(BaseModel):
    payload: dict[str, Any]
    prompt_template: str


class EmailReportSendResponse(BaseModel):
    sent: bool
    reason: str | None = None
    subject: str | None = None
    start: str | None = None
    end: str | None = None
    recipient_count: int = 0
    uncategorized_count: int = 0
    transaction_count: int = 0


class ProjectionRequest(BaseModel):
    start: date
    end: date
    utility_inflation_rate: float = 0.0
    general_inflation_rate: float = 0.0
    savings_apr: float = 0.0
