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

export type Transfer = {
  id: number;
  txn_out_id: string;
  txn_in_id: string;
  confidence: number;
  status: string;
  created_at: string;
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
