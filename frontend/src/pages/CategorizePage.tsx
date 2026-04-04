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
import { scoreTransactionSearch } from '../utils/transactionFilters';

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
    q: '',
    account_ids: [],
    account_id: '',
    category_id: null,
    category_family: '',
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
    'q',
    'accounts',
    'account_id',
    'category_id',
    'category_family',
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
    q: searchParams.get('q') ?? '',
    account_ids: (searchParams.get('accounts') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    account_id: searchParams.get('account_id') ?? '',
    category_id: categoryRaw ? Number(categoryRaw) : null,
    category_family: searchParams.get('category_family') ?? '',
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
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.account_ids.length)
    params.set('accounts', filters.account_ids.join(','));
  if (filters.account_id) params.set('account_id', filters.account_id);
  if (filters.category_id)
    params.set('category_id', String(filters.category_id));
  if (filters.category_family)
    params.set('category_family', filters.category_family);
  if (filters.uncategorized_only) params.set('uncategorized', '1');
  if (!filters.include_pending) params.set('pending', '0');
  if (filters.include_transfers) params.set('transfers', '1');
  return params;
}

type ParsedLLMAssignment = {
  transaction_id?: string;
  transaction_ref?: string;
  id?: string;
  category_id: number;
  reason?: string;
};

type ParsedLLMRule = {
  match_type: string;
  pattern: string;
  category_id: number;
  priority?: number;
  reason?: string;
};

type LLMPromptMode = 'high_precision' | 'high_coverage';

const ALLOWED_RULE_MATCH_TYPES = new Set([
  'contains',
  'regex',
  'merchant',
  'account'
]);

function computeShortTransactionIds(transactionIds: string[]): Map<string, string> {
  const uniqueIds = Array.from(new Set(transactionIds));
  const shortIds = new Map<string, string>();

  for (let prefixLength = 10; prefixLength <= 36; prefixLength += 1) {
    const seen = new Map<string, string>();
    let collided = false;
    for (const transactionId of uniqueIds) {
      const prefix = transactionId.slice(0, prefixLength);
      const existing = seen.get(prefix);
      if (existing && existing !== transactionId) {
        collided = true;
        break;
      }
      seen.set(prefix, transactionId);
    }
    if (!collided) {
      for (const transactionId of uniqueIds) {
        shortIds.set(transactionId, transactionId.slice(0, prefixLength));
      }
      return shortIds;
    }
  }

  for (const transactionId of uniqueIds) {
    shortIds.set(transactionId, transactionId);
  }
  return shortIds;
}

function resolveParsedAssignments(assignments: ParsedLLMAssignment[]) {
  return assignments.map((row) => ({
    transaction_id:
      row.transaction_id?.trim() ||
      row.transaction_ref?.trim() ||
      row.id?.trim() ||
      '',
    category_id: row.category_id,
    reason: row.reason
  }));
}

function extractTransactionKeywords(transaction: Transaction): string[] {
  const source = `${transaction.description_norm} ${transaction.merchant_name ?? ''} ${
    transaction.notes ?? ''
  }`;
  const tokens = source
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        !new Set([
          'the',
          'and',
          'from',
          'with',
          'for',
          'payment',
          'purchase',
          'debit',
          'credit',
          'card',
          'check'
        ]).has(token)
    );

  return Array.from(new Set(tokens)).slice(0, 5);
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
  const [creatingRulesFromLlm, setCreatingRulesFromLlm] = useState(true);
  const [exportingLlmPayload, setExportingLlmPayload] = useState(false);
  const [llmPromptMode, setLlmPromptMode] =
    useState<LLMPromptMode>('high_precision');
  const [llmPreflight, setLlmPreflight] = useState<{
    assignmentCount: number;
    ruleCount: number;
    unknownTransactionIds: string[];
    unknownTransactionCount: number;
    ambiguousTransactionIds: string[];
    ambiguousTransactionCount: number;
    invalidCategoryIds: number[];
    invalidCategoryCount: number;
    blankTransactionIdCount: number;
    invalidRuleMatchTypes: string[];
    blankRuleIndexes: number[];
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
      mode: 'account_to_grouped_category'
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
    const query = filters.q.trim();
    const matches: { txn: Transaction; score: number }[] = [];

    transactions.forEach((txn) => {
      if (filters.account_id && txn.account_id !== filters.account_id) return;
      if (excludedAccounts.has(txn.account_id)) return;
      if (
        filters.uncategorized_only &&
        txn.category_id !== null &&
        !uncategorizedCategoryIds.has(txn.category_id)
      ) {
        return;
      }
      const path =
        txn.category_id !== null
          ? (pathMap.get(txn.category_id) ?? txn.category_name ?? '')
          : txn.category_name ?? '';
      if (
        filters.category_family &&
        !path.startsWith(`${filters.category_family} >`) &&
        path !== filters.category_family
      ) {
        return;
      }
      if (filters.category_id && txn.category_id !== filters.category_id) {
        return;
      }

      const searchScore = query ? scoreTransactionSearch(txn, query) : 0;
      const categoryPathScore =
        query && path
          ? scoreTransactionSearch(
              {
                ...txn,
                description_raw: path,
                description_norm: path,
                category_name: path
              },
              query
            )
          : 0;
      const score = Math.max(searchScore, categoryPathScore);
      if (query && score <= 0) {
        return;
      }

      matches.push({ txn, score });
    });

    if (!query) {
      return matches.map((entry) => entry.txn);
    }

    return matches
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return (
          new Date(right.txn.posted_at).getTime() -
          new Date(left.txn.posted_at).getTime()
        );
      })
      .map((entry) => entry.txn);
  }, [
    transactions,
    filters.q,
    filters.account_ids,
    filters.account_id,
    filters.uncategorized_only,
    filters.category_id,
    filters.category_family,
    pathMap,
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
  }, [tableRowsPerPage, filters.start, filters.end, filters.q, filters.include_pending, filters.include_transfers, filters.category_id, filters.account_ids, filters.account_id, filters.uncategorized_only]);
  
  useEffect(() => {
    setTablePage(1);
  }, [filters.category_family]);

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
  const spendTransactions = useMemo(
    () => visibleTransactions.filter((txn) => txn.amount < 0),
    [visibleTransactions]
  );
  const totalInflow = useMemo(
    () =>
      visibleTransactions
        .filter((txn) => txn.amount > 0)
        .reduce((sum, txn) => sum + txn.amount, 0),
    [visibleTransactions]
  );
  const avgSpendPerTransaction = useMemo(
    () =>
      spendTransactions.length > 0
        ? totalOutflow / spendTransactions.length
        : 0,
    [spendTransactions, totalOutflow]
  );
  const avgSpendPerDay = useMemo(() => {
    if (!filters.start || !filters.end) return 0;
    const startDate = new Date(`${filters.start}T00:00:00`);
    const endDate = new Date(`${filters.end}T00:00:00`);
    const dayCount = Math.max(
      1,
      Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
    );
    return totalOutflow / dayCount;
  }, [filters.start, filters.end, totalOutflow]);
  const netFlow = useMemo(
    () => totalInflow - totalOutflow,
    [totalInflow, totalOutflow]
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
    if (!chosen.length) {
      setError('No suggestions selected to apply.');
      return;
    }
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
      const skippedSummary = Object.entries(response.skipped_reasons ?? {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(', ');

      setMessage(
        response.applied_count > 0
          ? `Applied ${response.applied_count} categories, skipped ${response.skipped_count}${
              skippedSummary ? ` (${skippedSummary})` : ''
            }.`
          : `Applied 0 categories. Skipped ${response.skipped_count}${
              skippedSummary ? ` (${skippedSummary})` : ''
            }.`
      );
      if (response.applied_count > 0) {
        setShowReview(false);
      }
      await Promise.all([loadTransactions(), loadSankey()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplyingSuggestions(false);
      setApplyTargetCount(0);
    }
  }

  function parseLLMJson(text: string): {
    proposed_assignments?: ParsedLLMAssignment[];
    proposed_rules?: ParsedLLMRule[];
  } {
    const trimmed = text.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }

    const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
    for (const block of fencedBlocks) {
      const candidate = block[1]?.trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // try next block
      }
    }

    // Try to find a balanced JSON object containing the expected key.
    const keyIndex = trimmed.indexOf('"proposed_assignments"');
    if (keyIndex >= 0) {
      let start = -1;
      for (let i = keyIndex; i >= 0; i -= 1) {
        if (trimmed[i] === '{') {
          start = i;
          break;
        }
      }
      if (start >= 0) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < trimmed.length; i += 1) {
          const ch = trimmed[i];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === '"') {
              inString = false;
            }
            continue;
          }
          if (ch === '"') {
            inString = true;
            continue;
          }
          if (ch === '{') depth += 1;
          if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
              const candidate = trimmed.slice(start, i + 1);
              try {
                return JSON.parse(candidate);
              } catch {
                break;
              }
            }
          }
        }
      }
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(
      'Could not parse categorization JSON. Paste an LLM response that includes a JSON object with proposed_assignments.'
    );
  }

  async function buildLLMPreflight(parsed: {
    proposed_assignments?: ParsedLLMAssignment[];
    proposed_rules?: ParsedLLMRule[];
  }) {
    const assignments = resolveParsedAssignments(parsed.proposed_assignments ?? []);
    const proposedRules = parsed.proposed_rules ?? [];
    const invalidRuleMatchTypes = Array.from(
      new Set(
        proposedRules
          .map((rule) => (rule.match_type ?? '').trim())
          .filter((matchType) => !ALLOWED_RULE_MATCH_TYPES.has(matchType))
      )
    );
    const blankRuleIndexes = proposedRules
      .map((rule, index) => ({
        index,
        pattern: (rule.pattern ?? '').trim()
      }))
      .filter((row) => !row.pattern)
      .map((row) => row.index);
    const seen = new Set<string>();
    const duplicateTransactionIds: string[] = [];
    let transferAssignmentCount = 0;

    for (const row of assignments) {
      if (seen.has(row.transaction_id)) {
        duplicateTransactionIds.push(row.transaction_id);
      } else {
        seen.add(row.transaction_id);
      }
      if (row.category_id === 47 || row.category_id === 46) {
        transferAssignmentCount += 1;
      }
    }

    const validation = await apiFetch<{
      unknown_transaction_ids: string[];
      unknown_transaction_count: number;
      ambiguous_transaction_ids: string[];
      ambiguous_transaction_count: number;
      invalid_category_ids: number[];
      invalid_category_count: number;
      blank_transaction_id_count: number;
    }>('/api/categorization/validate_llm', {
      method: 'POST',
      body: JSON.stringify({
        transaction_ids: assignments.map((row) => row.transaction_id),
        category_ids: [
          ...assignments.map((row) => row.category_id),
          ...proposedRules.map((rule) => rule.category_id)
        ]
      })
    });

    const transferAssignmentRatio =
      assignments.length > 0 ? transferAssignmentCount / assignments.length : 0;

    return {
      assignmentCount: assignments.length,
      ruleCount: proposedRules.length,
      unknownTransactionIds: validation.unknown_transaction_ids.slice(0, 20),
      unknownTransactionCount: validation.unknown_transaction_count,
      ambiguousTransactionIds: validation.ambiguous_transaction_ids.slice(0, 20),
      ambiguousTransactionCount: validation.ambiguous_transaction_count,
      invalidCategoryIds: validation.invalid_category_ids,
      invalidCategoryCount: validation.invalid_category_count,
      blankTransactionIdCount: validation.blank_transaction_id_count,
      invalidRuleMatchTypes,
      blankRuleIndexes: blankRuleIndexes.slice(0, 20),
      duplicateTransactionIds: duplicateTransactionIds.slice(0, 20),
      transferAssignmentCount,
      transferAssignmentRatio
    };
  }

  function buildCompactCategorizationPromptPack(payload: {
    transactions?: Array<{
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
    }>;
    categories?: Array<{
      id: number;
      name?: string;
      full_path: string;
      system_kind: string;
      parent_id: number | null;
    }>;
  }, mode: LLMPromptMode = 'high_precision') {
    const categoriesCompact = (payload.categories ?? []).map((category) => ({
      id: category.id,
      path: category.full_path,
      kind: category.system_kind
    }));

    const uncategorizedIds = new Set(
      categoriesCompact
        .filter((category) => category.kind === 'uncategorized')
        .map((category) => category.id)
    );

    const txns = payload.transactions ?? [];
    const shortTransactionIds = computeShortTransactionIds(
      txns.map((txn) => txn.id)
    );
    const reviewTransactions = txns
      .filter(
        (txn) =>
          txn.category_id === null ||
          (txn.category_id !== null && uncategorizedIds.has(txn.category_id))
      )
      .map((txn) => ({
        transaction_id: shortTransactionIds.get(txn.id) ?? txn.id,
        date: txn.date,
        amount: txn.amount,
        description: txn.description_norm,
        merchant: txn.merchant_canonical,
        account_type: txn.account_type,
        pending: txn.is_pending,
        transfer_hint: txn.is_transfer
      }));

    const merchantRefs = new Map<
      string,
      {
        merchant: string;
        category_id: number;
        category_path: string;
        count: number;
        sample: string;
      }
    >();
    const patternRefs = new Map<
      string,
      {
        pattern: string;
        category_id: number;
        category_path: string;
        count: number;
      }
    >();

    for (const txn of txns) {
      if (
        txn.category_id === null ||
        uncategorizedIds.has(txn.category_id) ||
        txn.is_transfer
      ) {
        continue;
      }

      const categoryPath = txn.category_path ?? 'Unknown';
      const normalized = txn.description_norm.trim();
      const merchantKey = txn.merchant_canonical?.trim().toLowerCase();
      if (merchantKey) {
        const existing = merchantRefs.get(merchantKey);
        if (!existing) {
          merchantRefs.set(merchantKey, {
            merchant: txn.merchant_canonical ?? merchantKey,
            category_id: txn.category_id,
            category_path: categoryPath,
            count: 1,
            sample: normalized
          });
        } else if (existing.category_id === txn.category_id) {
          existing.count += 1;
        }
      }

      const tokens = normalized.split(/\s+/).filter(Boolean).slice(0, 3);
      if (tokens.length >= 2) {
        const pattern = tokens.join(' ');
        const patternKey = `${pattern.toLowerCase()}::${txn.category_id}`;
        const existing = patternRefs.get(patternKey);
        if (!existing) {
          patternRefs.set(patternKey, {
            pattern,
            category_id: txn.category_id,
            category_path: categoryPath,
            count: 1
          });
        } else {
          existing.count += 1;
        }
      }
    }

    const merchantReference = [...merchantRefs.values()]
      .filter((row) => row.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 80)
      .map((row) => ({
        merchant: row.merchant,
        category_id: row.category_id,
        category_path: row.category_path,
        seen: row.count,
        sample: row.sample
      }));

    const patternReference = [...patternRefs.values()]
      .filter((row) => row.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 60);

    const compactPayload = {
      review_transactions: reviewTransactions,
      categories: categoriesCompact,
      merchant_reference: merchantReference,
      pattern_reference: patternReference,
      response_schema: {
        proposed_assignments: [
          { transaction_id: 'string', category_id: 0, reason: 'short' }
        ],
        proposed_rules: [
          {
            match_type: 'contains|regex|merchant|account',
            pattern: 'string',
            category_id: 0,
            priority: 800,
            reason: 'short'
          }
        ]
      }
    };

    const prompt = [
      'Return exactly one JSON object with keys `proposed_assignments` and `proposed_rules`.',
      'No prose, no markdown, no code fences.',
      'Categorize only `review_transactions` using only category IDs from `categories`.',
      'Use each provided `transaction_id` exactly as shown, even when abbreviated.',
      'Prefer `merchant_reference` first, then `pattern_reference`, then the transaction text itself.',
      mode === 'high_precision'
        ? 'Skip uncertain transactions instead of guessing.'
        : 'Maximize coverage across `review_transactions`, but still skip rows that would require guessing or invented facts.',
      'Use transfer categories 46/47 only for true transfers, card payments, or account moves.',
      'At most one assignment per transaction_id.',
      mode === 'high_precision'
        ? 'Create rules only for repeated, specific merchant/pattern signals; avoid broad words like PAYMENT, TRANSFER, PURCHASE.'
        : 'When `merchant_reference` is absent, use repeated text patterns and transaction context aggressively before leaving a row unassigned. Do not use uncategorized as a fallback.',
      mode === 'high_precision'
        ? 'Prefer fewer, higher-confidence assignments over broad coverage.'
        : 'High coverage mode: aim to categorize as many `review_transactions` as possible without inventing transaction IDs, categories, merchants, or transfer intent.',
      'Keep reasons very short.',
      'Output shape: {"proposed_assignments":[{"transaction_id":"...","category_id":123,"reason":"..."}],"proposed_rules":[{"match_type":"contains|regex|merchant|account","pattern":"...","category_id":123,"priority":800,"reason":"..."}]}.'
    ].join('\n');

    return { prompt, compactPayload };
  }

  const llmPayloadEstimate = useMemo(() => {
    const categoryEntries = categories.map((category) => ({
      id: category.id,
      name: category.name,
      full_path: pathMap.get(category.id) ?? category.name,
      system_kind: category.system_kind,
      parent_id: category.parent_id
    }));
    const transactionEntries = transactions.map((txn) => ({
      id: txn.id,
      date: txn.posted_at.slice(0, 10),
      amount: txn.amount,
      currency: txn.currency,
      description_norm: txn.description_norm,
      merchant_canonical: txn.merchant_name,
      account_type: txn.account_type,
      category_id: txn.category_id,
      category_path: txn.category_id
        ? (pathMap.get(txn.category_id) ?? txn.category_name ?? undefined)
        : undefined,
      is_pending: txn.is_pending,
      is_transfer: Boolean(txn.transfer_id)
    }));
    const { prompt, compactPayload } = buildCompactCategorizationPromptPack({
      transactions: transactionEntries,
      categories: categoryEntries
    }, llmPromptMode);
    const text = `${prompt}\n\n${JSON.stringify(compactPayload)}`;
    return {
      reviewCount: compactPayload.review_transactions.length,
      merchantRefCount: compactPayload.merchant_reference.length,
      patternRefCount: compactPayload.pattern_reference.length,
      chars: text.length,
      approxTokens: Math.ceil(text.length / 4)
    };
  }, [categories, llmPromptMode, pathMap, transactions]);

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
      const { prompt, compactPayload } = buildCompactCategorizationPromptPack(
        payload,
        llmPromptMode
      );

      const text = `${prompt}

## Input Data (JSON)
\`\`\`json
${JSON.stringify(compactPayload, null, 2)}
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
      const preflight = await buildLLMPreflight(parsed);
      setLlmPreflight(preflight);

      if (preflight.assignmentCount === 0) {
        throw new Error(
          'No proposed assignments found. Expected JSON shape: {"proposed_assignments":[{"transaction_id":"...","category_id":123}]}'
        );
      }

      if (preflight.invalidCategoryIds.length > 0) {
        throw new Error(
          `Invalid category IDs: ${preflight.invalidCategoryIds.join(', ')}`
        );
      }
      if (preflight.blankTransactionIdCount > 0) {
        throw new Error(
          `Assignments with blank transaction IDs: ${preflight.blankTransactionIdCount}`
        );
      }
      if (preflight.invalidRuleMatchTypes.length > 0) {
        throw new Error(
          `Invalid rule match types: ${preflight.invalidRuleMatchTypes.join(', ')}`
        );
      }
      if (preflight.blankRuleIndexes.length > 0) {
        throw new Error(
          `Rules with blank patterns at indexes: ${preflight.blankRuleIndexes.join(', ')}`
        );
      }
      if (preflight.ambiguousTransactionCount > 0) {
        throw new Error(
          `Ambiguous transaction IDs: ${preflight.ambiguousTransactionIds.join(', ')}`
        );
      }
      if (preflight.duplicateTransactionIds.length > 0) {
        throw new Error(
          `Duplicate transaction IDs in assignments: ${preflight.duplicateTransactionIds.join(
            ', '
          )}`
        );
      }
      if (preflight.unknownTransactionCount > 0) {
        const proceed = window.confirm(
          `LLM output includes ${preflight.unknownTransactionCount} unknown transaction IDs. Continue and skip them?`
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
            proposed_assignments: resolveParsedAssignments(
              parsed.proposed_assignments ?? []
            ).map((row) => ({
              transaction_id: row.transaction_id,
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
      const skippedSummary = Object.entries(response.skipped_reasons ?? {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(', ');

      setMessage(
        `Imported LLM output: applied ${response.applied_count}, skipped ${response.skipped_count}, rules created ${response.rules_created}${
          skippedSummary ? ` (${skippedSummary})` : ''
        }.`
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
            {filters.category_family && (
              <div className="toast">
                Chart filter: {filters.category_family}
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        category_family: ''
                      }))
                    }
                  >
                    Clear family filter
                  </button>
                </div>
              </div>
            )}
            {filters.account_id && (
              <div className="toast">
                Chart filter: account {accounts.find((account) => account.id === filters.account_id)?.name ?? filters.account_id}
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        account_id: ''
                      }))
                    }
                  >
                    Clear account filter
                  </button>
                </div>
              </div>
            )}
          </>
        }
        sections={[
          {
            id: 'studio-transactions',
            label: `Transactions (${visibleTransactions.length})`,
            content: (
              <>
                <div className="studio-metrics-inline">
                  <article className="studio-metric-pill">
                    <span className="studio-metric-label">Total spent</span>
                    <strong className="studio-metric-value">
                      ${totalOutflow.toFixed(2)}
                    </strong>
                  </article>
                  <article className="studio-metric-pill">
                    <span className="studio-metric-label">Avg spend</span>
                    <strong className="studio-metric-value">
                      ${avgSpendPerTransaction.toFixed(2)}
                    </strong>
                  </article>
                  <article className="studio-metric-pill">
                    <span className="studio-metric-label">Avg spend / day</span>
                    <strong className="studio-metric-value">
                      ${avgSpendPerDay.toFixed(2)}
                    </strong>
                  </article>
                </div>
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
            label: 'Spending Context',
            defaultCollapsed: true,
            content: (
              <div className="studio-metrics-wrap">
                <div className="studio-metrics-bar">
                  <article className="studio-metric-card">
                    <span className="studio-metric-label">Spend txns</span>
                    <strong className="studio-metric-value">
                      {spendTransactions.length}
                    </strong>
                  </article>
                  <article className="studio-metric-card">
                    <span className="studio-metric-label">Net flow</span>
                    <strong
                      className={`studio-metric-value ${
                        netFlow < 0 ? 'negative' : 'positive'
                      }`}
                    >
                      ${netFlow.toFixed(2)}
                    </strong>
                  </article>
                  <article className="studio-metric-card">
                    <span className="studio-metric-label">Uncategorized</span>
                    <strong className="studio-metric-value">
                      {uncategorizedCount}
                    </strong>
                  </article>
                </div>
                <div className="grid two">
                  <article className="card">
                    <h3>Top spending categories</h3>
                    <ul>
                      {topCategories.map((item) => (
                        <li key={item.category}>
                          {item.category}: ${item.amount.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  </article>
                  <article className="card">
                    <h3>Flow snapshot</h3>
                    <ul>
                      <li>Total inflow: ${totalInflow.toFixed(2)}</li>
                      <li>Total outflow: ${totalOutflow.toFixed(2)}</li>
                      <li>
                        Search + filter scope: {visibleTransactions.length}{' '}
                        transactions
                      </li>
                    </ul>
                  </article>
                </div>
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
            content: <SankeyChart nodes={sankey.nodes} links={sankey.links} height={500} />
          }
        ]}
      />
      {showReview && (
        <div className="modal-overlay">
          <div className="modal auto-categorize-modal">
            <div className="review-modal-head">
              <div>
                <h3>Review Auto-categorize Suggestions</h3>
                <p className="category-editor-note">Press Esc to close this review.</p>
              </div>
              <div className="review-summary-strip">
                <div className="review-summary-card">
                  <strong>{suggestions.length}</strong>
                  <span>Suggestions</span>
                </div>
                <div className="review-summary-card">
                  <strong>
                    {
                      suggestions.filter((item) => item.confidence >= minConfidence).length
                    }
                  </strong>
                  <span>Above threshold</span>
                </div>
                <div className="review-summary-card">
                  <strong>{selectedIds.size}</strong>
                  <span>Selected</span>
                </div>
              </div>
            </div>
            <div className="review-action-bar">
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
            <div className="review-llm-tools">
              <div>
                <button
                  type="button"
                  className={`secondary ${exportingLlmPayload ? 'button-loading' : ''}`}
                  onClick={exportLLMPayload}
                  disabled={exportingLlmPayload || importingLlm}
                >
                  {exportingLlmPayload
                    ? 'Exporting payload...'
                    : 'Copy compact LLM payload'}
                </button>
                <p className="category-editor-note">
                  Prompt mode:{' '}
                  {llmPromptMode === 'high_precision'
                    ? 'high precision'
                    : 'high coverage'}
                  . Approx size: {llmPayloadEstimate.approxTokens.toLocaleString()} tokens /{' '}
                  {llmPayloadEstimate.chars.toLocaleString()} chars.
                  {` ${llmPayloadEstimate.reviewCount} review rows, ${llmPayloadEstimate.merchantRefCount} merchant refs, ${llmPayloadEstimate.patternRefCount} pattern refs.`}
                </p>
              </div>
              <label>
                Prompt mode
                <select
                  value={llmPromptMode}
                  onChange={(e) =>
                    setLlmPromptMode(e.target.value as LLMPromptMode)
                  }
                >
                  <option value="high_precision">High precision</option>
                  <option value="high_coverage">High coverage</option>
                </select>
              </label>
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
                placeholder='{"proposed_assignments":[{"transaction_id":"1d58258383","category_id":123}]}'
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    const parsed = parseLLMJson(llmImportJson || '{}');
                    const preflight = await buildLLMPreflight(parsed);
                    setLlmPreflight(preflight);
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
                  Unknown transaction IDs: {llmPreflight.unknownTransactionCount}
                </p>
                <p className="category-editor-note">
                  Ambiguous transaction IDs: {llmPreflight.ambiguousTransactionCount}
                </p>
                <p className="category-editor-note">
                  Invalid category IDs: {llmPreflight.invalidCategoryCount}
                </p>
                <p className="category-editor-note">
                  Blank transaction IDs: {llmPreflight.blankTransactionIdCount}
                </p>
                <p className="category-editor-note">
                  Invalid rule match types: {llmPreflight.invalidRuleMatchTypes.length}
                </p>
                <p className="category-editor-note">
                  Blank rule patterns: {llmPreflight.blankRuleIndexes.length}
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
                        if (!txn) return 'Transaction details unavailable';
                        const keywords = extractTransactionKeywords(txn);
                        return (
                          <>
                            <div>
                              {txn.posted_at.slice(0, 10)} · {txn.description_norm} ·{' '}
                              {txn.account_name} · {txn.amount.toFixed(2)}
                            </div>
                            {!!keywords.length && (
                              <div className="review-keywords">
                                {keywords.map((keyword) => (
                                  <span key={keyword} className="review-keyword-chip">
                                    {keyword}
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        );
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
