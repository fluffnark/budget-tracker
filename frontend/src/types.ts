export type Account = {
  id: string;
  institution_name: string | null;
  name: string;
  type: string;
  currency: string;
  source_type: string;
  is_active: boolean;
  balance: number | null;
  available_balance: number | null;
  last_sync_at: string | null;
};

export type Transaction = {
  id: string;
  account_id: string;
  account_name: string;
  account_type: string;
  posted_at: string;
  amount: number;
  currency: string;
  description_raw: string;
  description_norm: string;
  is_pending: boolean;
  category_id: number | null;
  category_name: string | null;
  merchant_id: number | null;
  merchant_name: string | null;
  transfer_id: number | null;
  notes: string | null;
  manual_category_override: boolean;
};

export type Rule = {
  id: number;
  priority: number;
  match_type: string;
  pattern: string | null;
  category_id: number;
  merchant_override_id: number | null;
  is_active: boolean;
};

export type RuleCreateResponse = Rule & {
  match_count: number;
  sample_transaction_ids: string[];
};

export type RulePreviewResponse = {
  match_count: number;
  sample_transaction_ids: string[];
};

export type Category = {
  id: number;
  parent_id: number | null;
  name: string;
  system_kind: string;
  color: string | null;
  icon: string | null;
};

export type Settings = {
  sync_daily_hour: number;
  sync_daily_minute: number;
  simplefin_mock: boolean;
  scrub_default: boolean;
  auto_categorization: boolean;
  email_reports_enabled: boolean;
  email_report_day: number;
  email_report_hour: number;
  email_report_minute: number;
  email_report_recipients: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_from: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  smtp_password_set: boolean;
};

export type AuthStatus = {
  is_setup: boolean;
  is_authenticated: boolean;
  owner_email: string | null;
  simplefin_connected: boolean;
  simplefin_status: string | null;
};

export type SyncStatus = {
  running: boolean;
  mode: string | null;
  current_window: number;
  total_windows: number;
  progress: number;
  message: string;
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  last_result: Record<string, unknown>;
};

export type CategorizationSuggestion = {
  transaction_id: string;
  suggested_category_id: number;
  confidence: number;
  reason: string;
  category_path: string;
};

export type CategorizationSuggestResponse = {
  suggestions: CategorizationSuggestion[];
};

export type CategorizationApplyResponse = {
  applied_count: number;
  skipped_count: number;
  skipped_reasons: Record<string, number>;
};

export type BudgetCategoryPlanRow = {
  category_id: number;
  category_name: string;
  category_path: string;
  parent_category_name: string | null;
  planned_amount: number;
  actual_amount: number;
  remaining_amount: number;
  last_month_actual: number;
  avg_3_month_actual: number;
  is_fixed: boolean;
  is_essential: boolean;
  rollover_mode: 'none' | 'surplus_only' | 'next_month_cover';
};

export type BudgetFamilySummary = {
  family: string;
  planned_amount: number;
  actual_amount: number;
  remaining_amount: number;
  essential_planned: number;
  discretionary_planned: number;
};

export type BudgetMonthSnapshot = {
  month_start: string;
  income_target: number;
  starting_cash: number;
  planned_savings: number;
  suggested_income_target: number;
  suggested_planned_savings: number;
  leftover_strategy: 'unassigned' | 'send_to_savings' | 'send_to_debt';
  income_available: number;
  planned_spending: number;
  actual_spending: number;
  remaining_to_budget: number;
  essential_planned: number;
  discretionary_planned: number;
  rows: BudgetCategoryPlanRow[];
  family_summaries: BudgetFamilySummary[];
};

export type BudgetPeriodFamily = {
  family: string;
  amount: number;
  subcategories: { category: string; path: string; amount: number }[];
};

export type BudgetPeriodSnapshot = {
  period: 'weekly' | 'monthly' | 'yearly';
  start: string;
  end: string;
  total_spend: number;
  families: BudgetPeriodFamily[];
  trend: {
    label: string;
    start: string;
    end: string;
    total: number;
    families: Record<string, number>;
  }[];
};

export type RecurringPaymentCandidate = {
  label: string;
  category_name: string;
  family_name: string;
  cadence: string;
  occurrences: number;
  average_amount: number;
  estimated_monthly_cost: number;
  last_amount: number;
  last_posted_at: string;
  next_expected_at: string | null;
  is_cancel_candidate: boolean;
  review_reason: string | null;
};

export type BudgetRecurringSnapshot = {
  as_of: string;
  estimated_monthly_total: number;
  estimated_monthly_cancelable: number;
  cancel_candidates: RecurringPaymentCandidate[];
  essential_candidates: RecurringPaymentCandidate[];
  review_candidates: RecurringPaymentCandidate[];
};

export type LLMCategorizationImportResponse = {
  applied_count: number;
  skipped_count: number;
  skipped_reasons: Record<string, number>;
  rules_created: number;
  rules_applied_count: number;
};

export type EmailReportSendResponse = {
  sent: boolean;
  reason?: string | null;
  subject?: string | null;
  start?: string | null;
  end?: string | null;
  recipient_count: number;
  uncategorized_count: number;
  transaction_count: number;
};

export type AdvisorReportGenerateResponse = {
  start: string;
  end: string;
  days: number;
  stats: Record<string, any>;
  charts: Record<string, any>;
  scrubbed_payload: Record<string, any>;
  prompt_markdown: string;
};

export type AdvisorEmailPreviewResponse = {
  subject: string;
  recipients: string;
  markdown_body: string;
  html_body: string;
  start: string;
  end: string;
  days: number;
  stats: Record<string, any>;
  charts: Record<string, any>;
};

export type AdvisorEmailSendResponse = {
  sent: boolean;
  reason?: string | null;
  subject?: string | null;
  recipients: string;
  recipient_count: number;
  start?: string | null;
  end?: string | null;
};

export type SheetsExportSheet = {
  name: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
};

export type SheetsExportResponse = {
  workbook_name: string;
  generated_at: string;
  sheets: SheetsExportSheet[];
};
