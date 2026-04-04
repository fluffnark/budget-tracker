import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { apiFetch } from '../api';
import { CategorySelector } from '../components/CategorySelector';
import { CategoryTreeDropdown } from '../components/CategoryTreeDropdown';
import { SectionLayout } from '../components/SectionLayout';
import type {
  Category,
  RuleCreateResponse,
  RulePreviewResponse,
  Transaction
} from '../types';
import {
  applyTransactionFilters,
  type TxnFilterInput
} from '../utils/transactionFilters';

type DateHorizon = 'all' | 'one_year' | 'custom';

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function oneYearRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

const initialFilters: TxnFilterInput = {
  q: '',
  accountId: '',
  categoryId: '',
  minAmount: '',
  maxAmount: '',
  includePending: true
};

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<TxnFilterInput>({
    ...initialFilters,
    q: searchParams.get('q') ?? '',
    accountId: searchParams.get('account_id') ?? '',
    categoryId: searchParams.get('category_id') ?? ''
  });
  const [start, setStart] = useState(searchParams.get('start') ?? '');
  const [end, setEnd] = useState(searchParams.get('end') ?? '');
  const [horizon, setHorizon] = useState<DateHorizon>(() => {
    const preset = searchParams.get('preset');
    if (preset === 'one_year') return 'one_year';
    if (searchParams.get('start') || searchParams.get('end')) return 'custom';
    return 'all';
  });
  const [ruleToast, setRuleToast] = useState<{
    applied: number;
    ids: string[];
  } | null>(null);
  const [ruleAppliedIds, setRuleAppliedIds] = useState<Set<string>>(new Set());
  const [affectedIds, setAffectedIds] = useState<Set<string>>(new Set());
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  async function loadTransactions() {
    const params = new URLSearchParams({
      limit: '500',
      include_transfers: '1',
      include_pending: '1'
    });
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    if (filters.accountId) params.set('account_id', filters.accountId);
    if (filters.categoryId) params.set('category_id', filters.categoryId);
    const rows = await apiFetch<Transaction[]>(
      `/api/transactions?${params.toString()}`
    );
    setTransactions(rows);
  }

  useEffect(() => {
    loadTransactions().catch(() => setTransactions([]));
    apiFetch<Category[]>('/api/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const ids = searchParams.get('ids');
    if (!ids) return;
    const parsed = new Set(
      ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    );
    setAffectedIds(parsed);
  }, [searchParams]);

  useEffect(() => {
    const nextStart = searchParams.get('start') ?? '';
    const nextEnd = searchParams.get('end') ?? '';
    const preset = searchParams.get('preset');
    const nextQ = searchParams.get('q') ?? '';
    const nextAccountId = searchParams.get('account_id') ?? '';
    const nextCategoryId = searchParams.get('category_id') ?? '';
    setStart(nextStart);
    setEnd(nextEnd);
    setFilters((current) => ({
      ...current,
      q: nextQ,
      accountId: nextAccountId,
      categoryId: nextCategoryId
    }));
    setHorizon(
      preset === 'one_year'
        ? 'one_year'
        : nextStart || nextEnd
          ? 'custom'
          : 'all'
    );
  }, [searchParams]);

  const accounts = useMemo(() => {
    const map = new Map<string, string>();
    transactions.forEach((txn) => map.set(txn.account_id, txn.account_name));
    return Array.from(map.entries());
  }, [transactions]);

  const filtered = useMemo(() => {
    const base = applyTransactionFilters(transactions, filters);
    if (!affectedIds.size) return base;
    return base.filter((txn) => affectedIds.has(txn.id));
  }, [transactions, filters, affectedIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pageStart = (currentPageSafe - 1) * rowsPerPage;
  const pageRows = filtered.slice(pageStart, pageStart + rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, start, end, affectedIds, rowsPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  async function updateCategory(txnId: string, categoryId: number | null) {
    await apiFetch(`/api/transactions/${txnId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        category_id: categoryId
      })
    });
    await loadTransactions();
  }

  async function createRuleFromTransaction(txn: Transaction) {
    if (!txn.category_id) return;
    const pattern = txn.description_norm.split(' ').slice(0, 2).join(' ');
    const payload = {
      priority: 100,
      match_type: 'contains',
      pattern,
      category_id: txn.category_id
    };
    const preview = await apiFetch<RulePreviewResponse>('/api/rules/preview', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const created = await apiFetch<RuleCreateResponse>('/api/rules', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setRuleToast({
      applied: created.match_count,
      ids: created.sample_transaction_ids
    });
    setRuleAppliedIds(new Set(created.sample_transaction_ids));
    if (preview.match_count > 0) {
      setAffectedIds(new Set(created.sample_transaction_ids));
    }
    await loadTransactions();
  }

  function applyHorizon(nextHorizon: DateHorizon) {
    setHorizon(nextHorizon);
    if (nextHorizon === 'all') {
      setStart('');
      setEnd('');
      return;
    }
    if (nextHorizon === 'one_year') {
      const range = oneYearRange();
      setStart(range.start);
      setEnd(range.end);
    }
  }

  const filtersContent = (
    <div className="filters">
      <label>
        Horizon
        <select
          value={horizon}
          onChange={(e) => applyHorizon(e.target.value as DateHorizon)}
        >
          <option value="all">All</option>
          <option value="one_year">1 year</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label>
        Start
        <input
          type="date"
          value={start}
          onChange={(e) => {
            setHorizon('custom');
            setStart(e.target.value);
          }}
        />
      </label>
      <label>
        End
        <input
          type="date"
          value={end}
          onChange={(e) => {
            setHorizon('custom');
            setEnd(e.target.value);
          }}
        />
      </label>
      <label>
        Search
        <input
          placeholder="Keyword, merchant, category, or similar text"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
      </label>
      <label>
        Account
        <select
          value={filters.accountId}
          onChange={(e) =>
            setFilters({ ...filters, accountId: e.target.value })
          }
        >
          <option value="">All</option>
          {accounts.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Category
        <CategorySelector
          categories={categories}
          value={filters.categoryId ? Number(filters.categoryId) : null}
          onChange={(categoryId) =>
            setFilters({
              ...filters,
              categoryId: categoryId ? String(categoryId) : ''
            })
          }
          noneLabel="All"
        />
      </label>
      <label>
        Min Amount
        <input
          type="number"
          value={filters.minAmount}
          onChange={(e) =>
            setFilters({ ...filters, minAmount: e.target.value })
          }
        />
      </label>
      <label>
        Max Amount
        <input
          type="number"
          value={filters.maxAmount}
          onChange={(e) =>
            setFilters({ ...filters, maxAmount: e.target.value })
          }
        />
      </label>
      <label className="inline">
        <input
          type="checkbox"
          checked={filters.includePending}
          onChange={(e) =>
            setFilters({ ...filters, includePending: e.target.checked })
          }
        />
        Include pending
      </label>
      <button onClick={() => loadTransactions()}>Refresh</button>
      <p className="category-editor-note">
        Search ranks similar description matches and also checks merchant,
        category, account, and notes.
      </p>
      <Link to="/categorize">
        <button type="button" className="secondary">
          Open Categorization Studio
        </button>
      </Link>
    </div>
  );

  const tableContent = (
    <>
      {ruleToast && (
        <div className="toast">
          Rule saved. Applied to {ruleToast.applied} transactions.
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const ids = ruleToast.ids.join(',');
                setAffectedIds(new Set(ruleToast.ids));
                setSearchParams({ ids });
              }}
            >
              View affected transactions
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAffectedIds(new Set());
                setSearchParams({});
              }}
            >
              Clear filter
            </button>
          </div>
        </div>
      )}

      <table className="table dense">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Account</th>
            <th>Amount</th>
            <th>Category</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((txn) => (
            <tr key={txn.id}>
              <td>{txn.posted_at.slice(0, 10)}</td>
              <td>{txn.description_norm}</td>
              <td>{txn.account_name}</td>
              <td className={txn.amount < 0 ? 'negative' : 'positive'}>
                {txn.amount.toFixed(2)}
              </td>
              <td>
                <CategoryTreeDropdown
                  categories={categories}
                  value={txn.category_id}
                  onChange={(categoryId) => updateCategory(txn.id, categoryId)}
                />
              </td>
              <td>
                {txn.is_pending && <span className="badge">Pending</span>}
                {txn.transfer_id && <span className="badge">Transfer</span>}
                {ruleAppliedIds.has(txn.id) && (
                  <span className="badge">Rule applied</span>
                )}
                {txn.manual_category_override && (
                  <span className="badge">Manual</span>
                )}
              </td>
              <td>
                <button onClick={() => createRuleFromTransaction(txn)}>
                  Create rule
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="filters">
        <label>
          Rows per page
          <select
            value={rowsPerPage}
            onChange={(e) => setRowsPerPage(Number(e.target.value))}
          >
            {[25, 50, 100, 200].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <p className="category-editor-note">
          Showing {filtered.length === 0 ? 0 : pageStart + 1}-
          {Math.min(pageStart + rowsPerPage, filtered.length)} of{' '}
          {filtered.length}
        </p>
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPageSafe <= 1}
          >
            Previous
          </button>
          <span className="category-editor-note">
            Page {currentPageSafe} / {totalPages}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setCurrentPage((page) => Math.min(totalPages, page + 1))
            }
            disabled={currentPageSafe >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );

  return (
    <SectionLayout
      pageKey="transactions"
      title="Transactions"
      sections={[
        { id: 'tx-filters', label: 'Filters', content: filtersContent },
        {
          id: 'tx-table',
          label: `Transactions (${filtered.length})`,
          content: tableContent
        },
        {
          id: 'tx-advanced',
          label: 'Advanced Notes',
          defaultCollapsed: true,
          content: (
            <p className="category-editor-note">
              Manual category edits set an override flag and are not replaced by
              rule reclassification.
            </p>
          )
        }
      ]}
    />
  );
}
