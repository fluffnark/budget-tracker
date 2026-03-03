import { useEffect, useMemo, useRef, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useSearchParams } from 'react-router-dom';

import { apiFetch } from '../api';
import {
  computeRangeForPreset,
  type FilterState,
  FilterBar
} from '../components/FilterBar';
import { CategorySelector } from '../components/CategorySelector';
import { SankeyChart } from '../components/SankeyChart';
import { SectionLayout } from '../components/SectionLayout';
import type {
  CategorizationApplyResponse,
  LLMCategorizationImportResponse,
  CategorizationSuggestResponse,
  CategorizationSuggestion,
  Category,
  Settings,
  Transaction
} from '../types';
import { buildCategoryPathMap } from '../utils/categories';

type SankeyData = {
  nodes: {
    name: string;
    kind: string;
    color?: string | null;
    icon?: string | null;
    category_id?: number | null;
  }[];
  links: { source: number; target: number; value: number }[];
};

const FILTER_STORAGE_KEY = 'bt_categorize_filters_v1';

function defaultFilters(): FilterState {
  const range = computeRangeForPreset('last_3_months');
  return {
    preset: 'last_3_months',
    start: range.start,
    end: range.end,
    account_ids: [],
    category_id: null,
    uncategorized_only: false,
    include_pending: true,
    include_transfers: false
  };
}

function parseFilters(searchParams: URLSearchParams): FilterState | null {
  const hasAny = [
    'preset',
    'start',
    'end',
    'accounts',
    'category_id',
    'uncategorized',
    'pending',
    'transfers'
  ].some((key) => searchParams.has(key));
  if (!hasAny) return null;

  const base = defaultFilters();
  const preset = (searchParams.get('preset') ??
    base.preset) as FilterState['preset'];
  const categoryRaw = searchParams.get('category_id');
  return {
    preset,
    start: searchParams.get('start') ?? base.start,
    end: searchParams.get('end') ?? base.end,
    account_ids: (searchParams.get('accounts') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    category_id: categoryRaw ? Number(categoryRaw) : null,
    uncategorized_only: searchParams.get('uncategorized') === '1',
    include_pending: searchParams.get('pending') !== '0',
    include_transfers: searchParams.get('transfers') === '1'
  };
}

function serializeFilters(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('preset', filters.preset);
  params.set('start', filters.start);
  params.set('end', filters.end);
  if (filters.account_ids.length)
    params.set('accounts', filters.account_ids.join(','));
  if (filters.category_id)
    params.set('category_id', String(filters.category_id));
  if (filters.uncategorized_only) params.set('uncategorized', '1');
  if (!filters.include_pending) params.set('pending', '0');
  if (filters.include_transfers) params.set('transfers', '1');
  return params;
}

export function CategorizePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(defaultFilters());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sankey, setSankey] = useState<SankeyData>({ nodes: [], links: [] });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [suggestions, setSuggestions] = useState<CategorizationSuggestion[]>(
    []
  );
  const [tableRowsPerPage, setTableRowsPerPage] = useState(25);
  const [tablePage, setTablePage] = useState(1);
  const [reviewRowsPerPage, setReviewRowsPerPage] = useState(25);
  const [reviewPage, setReviewPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [minConfidence, setMinConfidence] = useState(0.85);
  const [updatingTxnIds, setUpdatingTxnIds] = useState<Set<string>>(new Set());
  const [applyTargetCount, setApplyTargetCount] = useState(0);
  const [llmImportJson, setLlmImportJson] = useState('');
  const [importingLlm, setImportingLlm] = useState(false);
  const [creatingRulesFromLlm, setCreatingRulesFromLlm] = useState(false);
  const [exportingLlmPayload, setExportingLlmPayload] = useState(false);
  const [llmPreflight, setLlmPreflight] = useState<{
    assignmentCount: number;
    ruleCount: number;
    unknownTransactionIds: string[];
    invalidCategoryIds: number[];
    duplicateTransactionIds: string[];
    transferAssignmentCount: number;
    transferAssignmentRatio: number;
  } | null>(null);

  const txAbortRef = useRef<AbortController | null>(null);
  const sankeyAbortRef = useRef<AbortController | null>(null);

  const pathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const uncategorizedCategoryIds = useMemo(
    () =>
      new Set(
        categories
          .filter((category) => category.system_kind === 'uncategorized')
          .map((category) => category.id)
      ),
    [categories]
  );

  useEffect(() => {
    const fromUrl = parseFilters(searchParams);
    if (fromUrl) {
      setFilters(fromUrl);
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(fromUrl));
      return;
    }
    const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as FilterState;
        setFilters(parsed);
        setSearchParams(serializeFilters(parsed), { replace: true });
        return;
      } catch {
        // ignore
      }
    }
    const defaults = defaultFilters();
    setFilters(defaults);
    setSearchParams(serializeFilters(defaults), { replace: true });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    setSearchParams(serializeFilters(filters), { replace: true });
  }, [filters, setSearchParams]);

  async function loadCategoriesAndSettings() {
    const [cats, settings] = await Promise.all([
      apiFetch<Category[]>('/api/categories'),
      apiFetch<Settings>('/api/settings')
    ]);
    setCategories(cats);
    setAutoEnabled(settings.auto_categorization);
  }

  async function loadTransactions() {
    txAbortRef.current?.abort();
    const controller = new AbortController();
    txAbortRef.current = controller;

    const params = new URLSearchParams({
      limit: '500',
      include_transfers: filters.include_transfers ? '1' : '0',
      include_pending: filters.include_pending ? '1' : '0',
      start: filters.start,
      end: filters.end
    });
    const rows = await apiFetch<Transaction[]>(
      `/api/transactions?${params.toString()}`,
      {
        signal: controller.signal
      }
    );
    setTransactions(rows);
  }

  async function loadSankey() {
    sankeyAbortRef.current?.abort();
    const controller = new AbortController();
    sankeyAbortRef.current = controller;

    const params = new URLSearchParams({
      start: filters.start,
      end: filters.end,
      include_pending: filters.include_pending ? '1' : '0',
      include_transfers: filters.include_transfers ? '1' : '0',
      mode: 'account_to_category'
    });
    if (filters.category_id)
      params.set('category_id', String(filters.category_id));

    const data = await apiFetch<SankeyData>(
      `/api/analytics/sankey?${params.toString()}`,
      {
        signal: controller.signal
      }
    );
    setSankey(data);
  }

  useEffect(() => {
    loadCategoriesAndSettings().catch(() => {
      setCategories([]);
      setAutoEnabled(false);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      Promise.all([loadTransactions(), loadSankey()]).catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Failed to refresh data');
      });
    }, 360);
    return () => window.clearTimeout(timer);
  }, [
    filters.start,
    filters.end,
    filters.include_pending,
    filters.include_transfers,
    filters.category_id,
    filters.account_ids,
    filters.uncategorized_only
  ]);

  useEffect(() => {
    if (!showReview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applyingSuggestions) {
        setShowReview(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showReview, applyingSuggestions]);

  const visibleTransactions = useMemo(() => {
    const excludedAccounts = new Set(filters.account_ids);
    return transactions.filter((txn) => {
      if (excludedAccounts.has(txn.account_id)) return false;
      if (
        filters.uncategorized_only &&
        txn.category_id !== null &&
        !uncategorizedCategoryIds.has(txn.category_id)
      ) {
        return false;
      }
      if (filters.category_id && txn.category_id !== filters.category_id)
        return false;
      return true;
    });
  }, [
    transactions,
    filters.account_ids,
    filters.uncategorized_only,
    filters.category_id,
    uncategorizedCategoryIds
  ]);

  const tableTotalPages = Math.max(
    1,
    Math.ceil(visibleTransactions.length / tableRowsPerPage)
  );
  const tablePageSafe = Math.min(tablePage, tableTotalPages);
  const tableStartIndex = (tablePageSafe - 1) * tableRowsPerPage;
  const pagedTransactions = visibleTransactions.slice(
    tableStartIndex,
    tableStartIndex + tableRowsPerPage
  );

  const reviewTotalPages = Math.max(
    1,
    Math.ceil(suggestions.length / reviewRowsPerPage)
  );
  const reviewPageSafe = Math.min(reviewPage, reviewTotalPages);
  const reviewStartIndex = (reviewPageSafe - 1) * reviewRowsPerPage;
  const pagedSuggestions = suggestions.slice(
    reviewStartIndex,
    reviewStartIndex + reviewRowsPerPage
  );

  useEffect(() => {
    setTablePage(1);
  }, [tableRowsPerPage, filters.start, filters.end, filters.include_pending, filters.include_transfers, filters.category_id, filters.account_ids, filters.uncategorized_only]);

  useEffect(() => {
    setReviewPage(1);
  }, [reviewRowsPerPage, suggestions.length, showReview]);

  async function updateCategory(txnId: string, categoryId: number | null) {
    setError('');
    const previous = transactions;
    setUpdatingTxnIds((prev) => new Set(prev).add(txnId));
    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === txnId
          ? {
              ...txn,
              category_id: categoryId,
              manual_category_override: categoryId !== null
            }
          : txn
      )
    );
    try {
      await apiFetch(`/api/transactions/${txnId}`, {
        method: 'PATCH',
        body: JSON.stringify({ category_id: categoryId })
      });
      setMessage('Category updated');
      await loadSankey();
    } catch (e) {
      setTransactions(previous);
      setError(e instanceof Error ? e.message : 'Failed to update category');
    } finally {
      setUpdatingTxnIds((prev) => {
        const next = new Set(prev);
        next.delete(txnId);
        return next;
      });
    }
  }

  const pieData = useMemo(() => {
    const outflowByCategory = new Map<string, number>();
    for (const txn of visibleTransactions) {
      if (txn.amount >= 0) continue;
      const key = txn.category_id
        ? (pathMap.get(txn.category_id) ?? 'Unknown')
        : 'Uncategorized > Needs Review';
      outflowByCategory.set(
        key,
        (outflowByCategory.get(key) ?? 0) + Math.abs(txn.amount)
      );
    }
    return Array.from(outflowByCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12);
  }, [visibleTransactions, pathMap]);

  const uncategorizedCount = useMemo(
    () =>
      visibleTransactions.filter(
        (txn) =>
          txn.category_id === null ||
          (txn.category_id !== null &&
            uncategorizedCategoryIds.has(txn.category_id))
      ).length,
    [visibleTransactions, uncategorizedCategoryIds]
  );
  const totalOutflow = useMemo(
    () =>
      visibleTransactions
        .filter((txn) => txn.amount < 0)
        .reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
    [visibleTransactions]
  );
  const topCategories = useMemo(() => pieData.slice(0, 3), [pieData]);
  const accounts = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; type: string }>();
    transactions.forEach((txn) => {
      byId.set(txn.account_id, {
        id: txn.account_id,
        name: txn.account_name,
        type: txn.account_type
      });
    });
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [transactions]);
  const transactionsById = useMemo(
    () => new Map(transactions.map((txn) => [txn.id, txn])),
    [transactions]
  );
  const validCategoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories]
  );

  async function runAutoCategorize() {
    setMessage('');
    setError('');
    setLoadingAuto(true);
    try {
      const selectedAccountIds = accounts
        .filter((account) => !filters.account_ids.includes(account.id))
        .map((account) => account.id);
      const useAccountFilter =
        selectedAccountIds.length > 0 &&
        selectedAccountIds.length < accounts.length;
      const result = await apiFetch<CategorizationSuggestResponse>(
        '/api/categorization/suggest',
        {
          method: 'POST',
          body: JSON.stringify({
            start: filters.start,
            end: filters.end,
            include_pending: filters.include_pending,
            include_transfers: filters.include_transfers,
            account_ids: useAccountFilter ? selectedAccountIds : undefined,
            max_suggestions: 200
          })
        }
      );
      setSuggestions(result.suggestions);
      setSelectedIds(
        new Set(
          result.suggestions
            .filter((item) => item.confidence >= minConfidence)
            .map((item) => item.transaction_id)
        )
      );
      setShowReview(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Auto-categorization failed'
      );
    } finally {
      setLoadingAuto(false);
    }
  }

  async function applySuggestions(
    overrideSuggestions?: CategorizationSuggestion[]
  ) {
    const chosen =
      overrideSuggestions ??
      suggestions.filter((item) => selectedIds.has(item.transaction_id));
    setApplyingSuggestions(true);
    setApplyTargetCount(chosen.length);
    setError('');
    try {
      const response = await apiFetch<CategorizationApplyResponse>(
        '/api/categorization/apply',
        {
          method: 'POST',
          body: JSON.stringify({
            suggestions: chosen.map((item) => ({
              transaction_id: item.transaction_id,
              suggested_category_id: item.suggested_category_id,
              confidence: item.confidence
            })),
            min_confidence: minConfidence,
            include_pending: filters.include_pending,
            allow_transfers: filters.include_transfers
          })
        }
      );
      setMessage(
        `Applied ${response.applied_count} categories, skipped ${response.skipped_count}.`
      );
      setShowReview(false);
      await Promise.all([loadTransactions(), loadSankey()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplyingSuggestions(false);
      setApplyTargetCount(0);
    }
  }

  function parseLLMJson(text: string): {
    proposed_assignments?: Array<{
      transaction_id: string;
      category_id: number;
      reason?: string;
    }>;
    proposed_rules?: Array<{
      match_type: string;
      pattern: string;
      category_id: number;
      priority?: number;
      reason?: string;
    }>;
  } {
    const trimmed = text.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error('Could not parse JSON from LLM response.');
  }

  function buildLLMPreflight(parsed: {
    proposed_assignments?: Array<{
      transaction_id: string;
      id?: string;
      category_id: number;
      reason?: string;
    }>;
    proposed_rules?: Array<{
      match_type: string;
      pattern: string;
      category_id: number;
      priority?: number;
      reason?: string;
    }>;
  }) {
    const assignments = (parsed.proposed_assignments ?? []).map((row) => ({
      transaction_id: row.transaction_id ?? row.id ?? '',
      category_id: row.category_id,
      reason: row.reason
    }));
    const proposedRules = parsed.proposed_rules ?? [];
    const seen = new Set<string>();
    const duplicateTransactionIds: string[] = [];
    const unknownTransactionIds: string[] = [];
    const invalidCategoryIdsSet = new Set<number>();
    let transferAssignmentCount = 0;

    for (const row of assignments) {
      if (seen.has(row.transaction_id)) {
        duplicateTransactionIds.push(row.transaction_id);
      } else {
        seen.add(row.transaction_id);
      }
      if (!transactionsById.has(row.transaction_id)) {
        unknownTransactionIds.push(row.transaction_id);
      }
      if (!validCategoryIds.has(row.category_id)) {
        invalidCategoryIdsSet.add(row.category_id);
      }
      if (row.category_id === 47 || row.category_id === 46) {
        transferAssignmentCount += 1;
      }
    }

    const transferAssignmentRatio =
      assignments.length > 0 ? transferAssignmentCount / assignments.length : 0;

    return {
      assignmentCount: assignments.length,
      ruleCount: proposedRules.length,
      unknownTransactionIds: unknownTransactionIds.slice(0, 20),
      invalidCategoryIds: Array.from(invalidCategoryIdsSet),
      duplicateTransactionIds: duplicateTransactionIds.slice(0, 20),
      transferAssignmentCount,
      transferAssignmentRatio
    };
  }

  async function exportLLMPayload() {
    setExportingLlmPayload(true);
    setError('');
    try {
      const params = new URLSearchParams({
        start: filters.start,
        end: filters.end,
        scrub: '1',
        hash_merchants: '0',
        round_amounts: '0'
      });
      const exportResponse = await apiFetch<{
        payload: Record<string, unknown>;
        prompt_template: string;
      }>(`/api/export/llm?${params.toString()}`);

      const payload = exportResponse.payload as {
        transactions?: Array<
          {
            id: string;
            date: string;
            amount: number;
            currency: string;
            description_norm: string;
            merchant_canonical: string | null;
            account_type: string;
            category_id: number | null;
            category_path?: string;
            is_pending: boolean;
            is_transfer: boolean;
          } & Record<string, unknown>
        >;
        categories?: Array<
          {
            id: number;
            full_path: string;
            system_kind: string;
            parent_id: number | null;
          } & Record<string, unknown>
        >;
      };
      const uncategorizedCategoryIds = new Set(
        (payload.categories ?? [])
          .filter((category) => category.system_kind === 'uncategorized')
          .map((category) => category.id)
      );
      const compactTransactions = (payload.transactions ?? []).map((txn) => ({
        transaction_id: txn.id,
        date: txn.date,
        amount: txn.amount,
        currency: txn.currency,
        description_norm: txn.description_norm,
        merchant_canonical: txn.merchant_canonical,
        account_type: txn.account_type,
        is_pending: txn.is_pending,
        is_transfer: txn.is_transfer,
        category_id: txn.category_id,
        category_path: txn.category_path ?? null,
        needs_category_review:
          txn.category_id === null ||
          (txn.category_id !== null && uncategorizedCategoryIds.has(txn.category_id))
      }));
      const compactCategories = (payload.categories ?? []).map((category) => ({
        id: category.id,
        name: (category as { name?: string }).name ?? null,
        full_path: category.full_path,
        system_kind: category.system_kind,
        parent_id: category.parent_id
      }));

      const uncategorizedOnly = {
        transactions: compactTransactions,
        categories: compactCategories,
        uncategorized_transaction_count: compactTransactions.filter(
          (txn) => txn.needs_category_review
        ).length,
        transaction_count: compactTransactions.length,
        uncategorized_category_ids: Array.from(uncategorizedCategoryIds),
        llm_response_schema: {
          proposed_assignments: [
            {
              transaction_id: 'string',
              category_id: 0,
              reason: 'short'
            }
          ],
          proposed_rules: [
            {
              match_type: 'contains|regex|merchant|account',
              pattern: 'string',
              category_id: 0,
              priority: 100,
              reason: 'short'
            }
          ]
        }
      };

      const text = `${exportResponse.prompt_template}

## Input Data (JSON)
\`\`\`json
${JSON.stringify(uncategorizedOnly, null, 2)}
\`\`\`
`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) {
          throw new Error('Clipboard copy is unavailable in this browser context.');
        }
      }
      setMessage('Copied LLM categorization payload to clipboard.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export LLM payload');
    } finally {
      setExportingLlmPayload(false);
    }
  }

  async function importLLMResponse() {
    setImportingLlm(true);
    setError('');
    try {
      const parsed = parseLLMJson(llmImportJson || '{}');
      const preflight = buildLLMPreflight(parsed);
      setLlmPreflight(preflight);

      if (preflight.invalidCategoryIds.length > 0) {
        throw new Error(
          `Invalid category IDs: ${preflight.invalidCategoryIds.join(', ')}`
        );
      }
      if (preflight.duplicateTransactionIds.length > 0) {
        throw new Error(
          `Duplicate transaction IDs in assignments: ${preflight.duplicateTransactionIds.join(
            ', '
          )}`
        );
      }
      if (preflight.unknownTransactionIds.length > 0) {
        const proceed = window.confirm(
          `LLM output includes ${preflight.unknownTransactionIds.length} unknown transaction IDs. Continue and skip them?`
        );
        if (!proceed) return;
      }
      if (preflight.transferAssignmentRatio >= 0.5 && preflight.assignmentCount >= 10) {
        const proceed = window.confirm(
          `LLM assigned ${
            preflight.transferAssignmentCount
          }/${preflight.assignmentCount} rows to transfer categories. Continue?`
        );
        if (!proceed) return;
      }

      const response = await apiFetch<LLMCategorizationImportResponse>(
        '/api/categorization/import_llm',
        {
          method: 'POST',
          body: JSON.stringify({
            proposed_assignments: (parsed.proposed_assignments ?? []).map((row) => ({
              transaction_id:
                row.transaction_id ?? (row as { id?: string }).id ?? '',
              category_id: row.category_id,
              reason: row.reason
            })),
            proposed_rules: parsed.proposed_rules ?? [],
            min_confidence: 0,
            include_pending: filters.include_pending,
            allow_transfers: filters.include_transfers,
            apply_rules: creatingRulesFromLlm
          })
        }
      );

      setMessage(
        `Imported LLM output: applied ${response.applied_count}, skipped ${response.skipped_count}, rules created ${response.rules_created}.`
      );
      setShowReview(false);
      await Promise.all([loadTransactions(), loadSankey()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import LLM response');
    } finally {
      setImportingLlm(false);
    }
  }

  function resetFilters() {
    const defaults = defaultFilters();
    setFilters(defaults);
  }

  return (
    <>
      <SectionLayout
        pageKey="categorize"
        title="Categorization Studio"
        intro={
          <>
            {message && <p className="toast">{message}</p>}
            {error && <p className="error">{error}</p>}
            <FilterBar
              value={filters}
              accounts={accounts}
              categories={categories}
              onChange={setFilters}
              onReset={resetFilters}
              actions={
                <button
                  type="button"
                  onClick={runAutoCategorize}
                  disabled={!autoEnabled || loadingAuto}
                  className={loadingAuto ? 'button-loading' : ''}
                  title={
                    autoEnabled
                      ? 'Suggest categories for uncategorized transactions'
                      : 'Set AUTO_CATEGORIZATION=1 to enable'
                  }
                >
                  {loadingAuto ? 'Auto-categorizing...' : 'Auto-categorize'}
                </button>
              }
            />
          </>
        }
        sections={[
          {
            id: 'studio-transactions',
            label: `Transactions (${visibleTransactions.length})`,
            content: (
              <>
                <table className="table dense" data-testid="categorize-layout">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Account</th>
                      <th>Amount</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTransactions.map((txn) => (
                      <tr key={txn.id}>
                        <td>{txn.posted_at.slice(0, 10)}</td>
                        <td>{txn.description_norm}</td>
                        <td>{txn.account_name}</td>
                        <td className={txn.amount < 0 ? 'negative' : 'positive'}>
                          {txn.amount.toFixed(2)}
                        </td>
                        <td>
                          <CategorySelector
                            categories={categories}
                            value={txn.category_id}
                            onChange={(categoryId) =>
                              updateCategory(txn.id, categoryId)
                            }
                            showSearch={false}
                          />
                          {updatingTxnIds.has(txn.id) && <small>Saving...</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row-actions">
                  <label className="inline">
                    Rows
                    <select
                      value={tableRowsPerPage}
                      onChange={(e) => setTableRowsPerPage(Number(e.target.value))}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                    </select>
                  </label>
                  <span>
                    Showing {visibleTransactions.length === 0 ? 0 : tableStartIndex + 1}
                    -
                    {Math.min(tableStartIndex + tableRowsPerPage, visibleTransactions.length)} of{' '}
                    {visibleTransactions.length}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                    disabled={tablePageSafe <= 1}
                  >
                    Prev
                  </button>
                  <span>
                    Page {tablePageSafe}/{tableTotalPages}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setTablePage((prev) => Math.min(tableTotalPages, prev + 1))
                    }
                    disabled={tablePageSafe >= tableTotalPages}
                  >
                    Next
                  </button>
                </div>
              </>
            )
          },
          {
            id: 'studio-summary',
            label: 'Summary KPIs',
            content: (
              <div className="grid two">
                <article className="card">
                  <h3>Total outflow</h3>
                  <p className="big">${totalOutflow.toFixed(2)}</p>
                </article>
                <article className="card">
                  <h3>Uncategorized</h3>
                  <p className="big">{uncategorizedCount}</p>
                  <ul>
                    {topCategories.map((item) => (
                      <li key={item.category}>
                        {item.category}: ${item.amount.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                </article>
              </div>
            )
          },
          {
            id: 'studio-pie',
            label: 'Category Share',
            content: (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="amount"
                    nameKey="category"
                    outerRadius={92}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell
                        key={entry.category}
                        fill={`var(--series-${(idx % 5) + 1})`}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )
          },
          {
            id: 'studio-sankey',
            label: 'Sankey',
            content: <SankeyChart nodes={sankey.nodes} links={sankey.links} />
          }
        ]}
      />
      {showReview && (
        <div className="modal-overlay">
          <div className="modal auto-categorize-modal">
            <h3>Review Auto-categorize Suggestions</h3>
            <p className="category-editor-note">Press Esc to close this review.</p>
            <div className="filters">
              <label>
                Min confidence
                <input
                  className="confidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                className="secondary"
                disabled={applyingSuggestions}
                onClick={() =>
                  setSelectedIds(
                    new Set(
                      suggestions
                        .filter((item) => item.confidence >= minConfidence)
                        .map((item) => item.transaction_id)
                    )
                  )
                }
              >
                Select above threshold
              </button>
              <button
                type="button"
                className="secondary"
                disabled={applyingSuggestions}
                onClick={async () => {
                  const aboveThreshold = suggestions.filter(
                    (item) => item.confidence >= minConfidence
                  );
                  setSelectedIds(
                    new Set(aboveThreshold.map((item) => item.transaction_id))
                  );
                  await applySuggestions(aboveThreshold);
                }}
              >
                Apply all above threshold
              </button>
              <button
                type="button"
                onClick={() => {
                  void applySuggestions();
                }}
                disabled={applyingSuggestions || selectedIds.size === 0}
                className={applyingSuggestions ? 'button-loading' : ''}
              >
                {applyingSuggestions
                  ? `Applying ${applyTargetCount}...`
                  : `Apply selected (${selectedIds.size})`}
              </button>
            </div>
            <div className="filters">
              <button
                type="button"
                className={`secondary ${exportingLlmPayload ? 'button-loading' : ''}`}
                onClick={exportLLMPayload}
                disabled={exportingLlmPayload || importingLlm}
              >
                {exportingLlmPayload
                  ? 'Exporting payload...'
                  : 'Copy LLM payload (uncategorized)'}
              </button>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={creatingRulesFromLlm}
                  onChange={(e) => setCreatingRulesFromLlm(e.target.checked)}
                />
                Apply proposed rules too
              </label>
            </div>
            <label>
              Paste LLM JSON response
              <textarea
                rows={8}
                value={llmImportJson}
                onChange={(e) => setLlmImportJson(e.target.value)}
                placeholder='{"proposed_assignments":[{"transaction_id":"...","category_id":123}]}'
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  try {
                    const parsed = parseLLMJson(llmImportJson || '{}');
                    setLlmPreflight(buildLLMPreflight(parsed));
                    setMessage('LLM response validated.');
                    setError('');
                  } catch (e) {
                    setLlmPreflight(null);
                    setError(
                      e instanceof Error ? e.message : 'Failed to validate LLM response'
                    );
                  }
                }}
                disabled={!llmImportJson.trim() || importingLlm}
              >
                Validate LLM response
              </button>
              <button
                type="button"
                onClick={importLLMResponse}
                disabled={importingLlm || !llmImportJson.trim()}
                className={importingLlm ? 'button-loading' : ''}
              >
                {importingLlm ? 'Importing LLM response...' : 'Import LLM response'}
              </button>
            </div>
            {llmPreflight && (
              <div className="sync-progress-wrap">
                <div className="sync-progress-head">
                  <strong>LLM Preflight</strong>
                  <span>
                    {llmPreflight.assignmentCount} assignments, {llmPreflight.ruleCount} rules
                  </span>
                </div>
                <p className="category-editor-note">
                  Unknown transaction IDs: {llmPreflight.unknownTransactionIds.length}
                </p>
                <p className="category-editor-note">
                  Invalid category IDs: {llmPreflight.invalidCategoryIds.length}
                </p>
                <p className="category-editor-note">
                  Duplicate transaction IDs: {llmPreflight.duplicateTransactionIds.length}
                </p>
                <p className="category-editor-note">
                  Transfer assignments: {llmPreflight.transferAssignmentCount}/
                  {llmPreflight.assignmentCount} (
                  {(llmPreflight.transferAssignmentRatio * 100).toFixed(1)}%)
                </p>
              </div>
            )}
            {applyingSuggestions && (
              <div className="sync-progress-wrap" aria-live="polite">
                <div className="sync-progress-head">
                  <strong>Applying suggestions</strong>
                  <span>{applyTargetCount} transactions</span>
                </div>
                <div className="progress-indeterminate" />
              </div>
            )}
            <table className="table dense">
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Transaction</th>
                  <th>Suggestion</th>
                  <th>Confidence</th>
                  <th>Reason</th>
                  <th>Apply</th>
                </tr>
              </thead>
              <tbody>
                {pagedSuggestions.map((item) => (
                  <tr key={item.transaction_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.transaction_id)}
                        onChange={(e) =>
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.transaction_id);
                            else next.delete(item.transaction_id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      {(() => {
                        const txn = transactionsById.get(item.transaction_id);
                        if (!txn) return `Transaction ${item.transaction_id.slice(0, 8)}`;
                        return `${txn.posted_at.slice(0, 10)} · ${txn.description_norm} · ${
                          txn.account_name
                        } · ${txn.amount.toFixed(2)}`;
                      })()}
                    </td>
                    <td>{item.category_path}</td>
                    <td>{item.confidence.toFixed(2)}</td>
                    <td className="reason">{item.reason}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        disabled={applyingSuggestions}
                        onClick={() => applySuggestions([item])}
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row-actions">
              <label className="inline">
                Rows
                <select
                  value={reviewRowsPerPage}
                  onChange={(e) => setReviewRowsPerPage(Number(e.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
              <span>
                Showing {suggestions.length === 0 ? 0 : reviewStartIndex + 1}-
                {Math.min(reviewStartIndex + reviewRowsPerPage, suggestions.length)} of{' '}
                {suggestions.length}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => setReviewPage((prev) => Math.max(1, prev - 1))}
                disabled={reviewPageSafe <= 1}
              >
                Prev
              </button>
              <span>
                Page {reviewPageSafe}/{reviewTotalPages}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setReviewPage((prev) => Math.min(reviewTotalPages, prev + 1))
                }
                disabled={reviewPageSafe >= reviewTotalPages}
              >
                Next
              </button>
            </div>
            <div className="row-actions">
              <button
                className="secondary"
                onClick={() => setShowReview(false)}
                disabled={applyingSuggestions}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
