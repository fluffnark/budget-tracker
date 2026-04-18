from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    email: str


class AuthStatusResponse(BaseModel):
    is_setup: bool
    is_authenticated: bool
    owner_email: str | None = None
    simplefin_connected: bool = False
    simplefin_status: str | None = None


class AuthSetupRequest(BaseModel):
    email: str
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class OwnerEmailChangeRequest(BaseModel):
    current_password: str
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


class CategorizationValidateLLMRequest(BaseModel):
    transaction_ids: list[str]
    category_ids: list[int]


class CategorizationValidateLLMResponse(BaseModel):
    unknown_transaction_ids: list[str]
    unknown_transaction_count: int
    ambiguous_transaction_ids: list[str]
    ambiguous_transaction_count: int
    invalid_category_ids: list[int]
    invalid_category_count: int
    blank_transaction_id_count: int


class TransactionPatchRequest(BaseModel):
    category_id: int | None = None
    merchant_id: int | None = None
    notes: str | None = None
    is_pending: bool | None = None
    is_reviewed: bool | None = None


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
    is_reviewed: bool
    reviewed_at: datetime | None


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


class MerchantHistoryBucket(BaseModel):
    bucket_start: str
    bucket_label: str
    total: float
    merchants: dict[str, float]


class MerchantHistoryMerchant(BaseModel):
    merchant: str
    total: float
    average_per_bucket: float
    latest_bucket: float
    active_buckets: int
    sparkline: list[float]


class MerchantHistoryFamilyLeader(BaseModel):
    family: str
    merchant: str
    total: float
    family_total: float
    share_of_family: float


class MerchantHistoryResponse(BaseModel):
    start: str
    end: str
    bucket: str
    top_merchants: list[MerchantHistoryMerchant]
    buckets: list[MerchantHistoryBucket]
    top_by_family: list[MerchantHistoryFamilyLeader]


class CategoryResponse(BaseModel):
    id: int
    parent_id: int | None
    name: str
    system_kind: str
    spend_bucket: str | None = None
    color: str | None = None
    icon: str | None = None


class CategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    system_kind: str = Field(pattern="^(income|expense|transfer|uncategorized)$")
    parent_id: int | None = None
    spend_bucket: str | None = Field(
        default=None,
        pattern="^(essential|discretionary|savings|debt|income|transfer|uncategorized)$",
    )
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=50)


class CategoryPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    system_kind: str | None = Field(
        default=None, pattern="^(income|expense|transfer|uncategorized)$"
    )
    parent_id: int | None = None
    spend_bucket: str | None = Field(
        default=None,
        pattern="^(essential|discretionary|savings|debt|income|transfer|uncategorized)$",
    )
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=50)


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


class SheetsExportSheetResponse(BaseModel):
    name: str
    columns: list[str]
    rows: list[list[Any]]


class SheetsExportResponse(BaseModel):
    workbook_name: str
    generated_at: str
    sheets: list[SheetsExportSheetResponse]


class EmailReportSendResponse(BaseModel):
    sent: bool
    reason: str | None = None
    subject: str | None = None
    start: str | None = None
    end: str | None = None
    recipient_count: int = 0
    uncategorized_count: int = 0
    transaction_count: int = 0


class AdvisorReportGenerateRequest(BaseModel):
    days: int = Field(default=30, ge=7, le=366)
    end_date: date | None = None
    include_pending: bool = True
    include_transfers: bool = False
    hash_merchants: bool = True
    round_amounts: bool = False


class AdvisorReportGenerateResponse(BaseModel):
    start: str
    end: str
    days: int
    stats: dict[str, Any]
    charts: dict[str, Any]
    scrubbed_payload: dict[str, Any]
    prompt_markdown: str


class AdvisorEmailPreviewRequest(BaseModel):
    days: int = Field(default=30, ge=7, le=366)
    end_date: date | None = None
    include_pending: bool = True
    include_transfers: bool = False
    hash_merchants: bool = True
    round_amounts: bool = False
    advisor_response: str = ""
    recipients: str | None = None


class AdvisorEmailPreviewResponse(BaseModel):
    subject: str
    recipients: str
    markdown_body: str
    html_body: str
    start: str
    end: str
    days: int
    stats: dict[str, Any]
    charts: dict[str, Any]


class AdvisorEmailSendRequest(AdvisorEmailPreviewRequest):
    pass


class AdvisorEmailSendResponse(BaseModel):
    sent: bool
    reason: str | None = None
    subject: str | None = None
    recipients: str = ""
    recipient_count: int = 0
    start: str | None = None
    end: str | None = None


class ProjectionRequest(BaseModel):
    start: date
    end: date
    utility_inflation_rate: float = 0.0
    general_inflation_rate: float = 0.0
    savings_apr: float = 0.0


class BudgetCategoryPlanRow(BaseModel):
    category_id: int
    category_name: str
    category_path: str
    parent_category_name: str | None = None
    planned_amount: float
    actual_amount: float
    remaining_amount: float
    last_month_actual: float
    avg_3_month_actual: float
    is_fixed: bool
    is_essential: bool
    rollover_mode: str = Field(pattern="^(none|surplus_only|next_month_cover)$")


class BudgetFamilySummary(BaseModel):
    family: str
    planned_amount: float
    actual_amount: float
    remaining_amount: float
    essential_planned: float
    discretionary_planned: float


class BudgetMonthResponse(BaseModel):
    month_start: date
    income_target: float
    starting_cash: float
    planned_savings: float
    suggested_income_target: float
    suggested_planned_savings: float
    leftover_strategy: str
    income_available: float
    planned_spending: float
    actual_spending: float
    remaining_to_budget: float
    essential_planned: float
    discretionary_planned: float
    rows: list[BudgetCategoryPlanRow]
    family_summaries: list[BudgetFamilySummary]


class BudgetCategoryPlanPatch(BaseModel):
    category_id: int
    planned_amount: float = Field(default=0.0, ge=0.0)
    is_fixed: bool = False
    is_essential: bool = True
    rollover_mode: str = Field(default="none", pattern="^(none|surplus_only|next_month_cover)$")


class BudgetMonthPatchRequest(BaseModel):
    month_start: date
    income_target: float = 0.0
    starting_cash: float = 0.0
    planned_savings: float = 0.0
    leftover_strategy: str = Field(
        default="unassigned", pattern="^(unassigned|send_to_savings|send_to_debt)$"
    )
    rows: list[BudgetCategoryPlanPatch]


class BudgetPeriodFamilySummary(BaseModel):
    family: str
    amount: float
    subcategories: list[dict[str, Any]]


class BudgetPeriodTrendPoint(BaseModel):
    label: str
    start: date
    end: date
    total: float
    families: dict[str, float]


class BudgetPeriodResponse(BaseModel):
    period: str
    start: date
    end: date
    total_spend: float
    families: list[BudgetPeriodFamilySummary]
    trend: list[BudgetPeriodTrendPoint]


class RecurringPaymentCandidate(BaseModel):
    label: str
    category_name: str
    family_name: str
    cadence: str
    occurrences: int
    average_amount: float
    estimated_monthly_cost: float
    last_amount: float
    last_posted_at: date
    next_expected_at: date | None = None
    is_cancel_candidate: bool
    review_reason: str | None = None


class BudgetRecurringResponse(BaseModel):
    as_of: date
    estimated_monthly_total: float
    estimated_monthly_cancelable: float
    cancel_candidates: list[RecurringPaymentCandidate]
    essential_candidates: list[RecurringPaymentCandidate]
    review_candidates: list[RecurringPaymentCandidate]
