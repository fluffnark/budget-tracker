import { type ReactNode, useMemo, useState } from 'react';

import { CategorySelector } from './CategorySelector';
import type { Category } from '../types';

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'one_year'
  | 'ytd'
  | 'custom';

export type FilterState = {
  preset: PeriodPreset;
  start: string;
  end: string;
  q: string;
  min_amount: string;
  max_amount: string;
  account_ids: string[];
  account_id?: string;
  category_id: number | null;
  category_family?: string;
  review_state?: 'all' | 'needs_review' | 'reviewed';
  uncategorized_only: boolean;
  include_pending: boolean;
  include_transfers: boolean;
};

export type AccountFilterOption = {
  id: string;
  name: string;
  type: string;
};

type Props = {
  value: FilterState;
  accounts: AccountFilterOption[];
  categories: Category[];
  onChange: (next: FilterState) => void;
  onReset: () => void;
  disabled?: boolean;
  actions?: ReactNode;
};

export function computeRangeForPreset(preset: PeriodPreset): {
  start: string;
  end: string;
} {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === 'custom') {
    return { start: iso(today), end: iso(today) };
  }
  if (preset === 'this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: iso(start), end: iso(today) };
  }
  if (preset === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: iso(start), end: iso(end) };
  }
  if (preset === 'last_3_months') {
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    return { start: iso(start), end: iso(today) };
  }
  if (preset === 'one_year') {
    const start = new Date(today);
    start.setFullYear(today.getFullYear() - 1);
    return { start: iso(start), end: iso(today) };
  }
  const start = new Date(today.getFullYear(), 0, 1);
  return { start: iso(start), end: iso(today) };
}

export function FilterBar({
  value,
  accounts,
  categories,
  onChange,
  onReset,
  disabled = false,
  actions
}: Props) {
  const [accountQuery, setAccountQuery] = useState('');
  const accountQueryNorm = accountQuery.trim().toLowerCase();
  const filteredAccounts = useMemo(() => {
    if (!accountQueryNorm) return accounts;
    return accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(accountQueryNorm) ||
        account.type.toLowerCase().includes(accountQueryNorm)
    );
  }, [accounts, accountQueryNorm]);

  function update(patch: Partial<FilterState>) {
    onChange({ ...value, ...patch });
  }

  function setPreset(preset: PeriodPreset) {
    if (preset === 'custom') {
      update({ preset });
      return;
    }
    const range = computeRangeForPreset(preset);
    update({
      preset,
      start: range.start,
      end: range.end
    });
  }

  function selectAccountSet(nextIds: string[]) {
    update({ account_ids: nextIds, account_id: '' });
  }

  return (
    <div className="card filterbar">
      <div className="filters">
        <label>
          Period
          <select
            value={value.preset}
            disabled={disabled}
            onChange={(e) => setPreset(e.target.value as PeriodPreset)}
          >
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="last_3_months">Last 3 months</option>
            <option value="one_year">1 year</option>
            <option value="ytd">YTD</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        {value.preset === 'custom' && (
          <>
            <label>
              Start
              <input
                type="date"
                value={value.start}
                disabled={disabled}
                onChange={(e) => update({ start: e.target.value })}
              />
            </label>
            <label>
              End
              <input
                type="date"
                value={value.end}
                disabled={disabled}
                onChange={(e) => update({ end: e.target.value })}
              />
            </label>
          </>
        )}

        <label>
          Search
          <input
            placeholder="Keyword, merchant, category, or similar text"
            value={value.q}
            disabled={disabled}
            onChange={(e) => update({ q: e.target.value })}
          />
        </label>

        <label>
          Min amount
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.min_amount}
            disabled={disabled}
            onChange={(e) => update({ min_amount: e.target.value })}
          />
        </label>

        <label>
          Max amount
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.max_amount}
            disabled={disabled}
            onChange={(e) => update({ max_amount: e.target.value })}
          />
        </label>

        <label>
          Category
          <CategorySelector
            categories={categories}
            value={value.category_id}
            onChange={(category_id) =>
              update({
                category_id,
                category_family: '',
                uncategorized_only: false
              })
            }
            noneLabel="All categories"
            showSearch
          />
        </label>

        <button
          type="button"
          className={value.uncategorized_only ? '' : 'secondary'}
          disabled={disabled}
          title="Toggle to only show transactions that still need a category"
          onClick={() =>
            update({
              uncategorized_only: !value.uncategorized_only,
              category_id: null,
              category_family: ''
            })
          }
        >
          Uncategorized
        </button>

        <label>
          Review state
          <select
            value={value.review_state ?? 'all'}
            disabled={disabled}
            onChange={(e) =>
              update({
                review_state: e.target.value as NonNullable<FilterState['review_state']>
              })
            }
          >
            <option value="all">All</option>
            <option value="needs_review">Needs review</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>

        <label className="inline">
          <input
            type="checkbox"
            checked={value.include_pending}
            disabled={disabled}
            onChange={(e) => update({ include_pending: e.target.checked })}
          />
          Include pending
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={value.include_transfers}
            disabled={disabled}
            onChange={(e) => update({ include_transfers: e.target.checked })}
          />
          Include transfers
        </label>
        <button
          type="button"
          className="secondary"
          onClick={onReset}
          disabled={disabled}
          title="Reset date range, search, category, toggles, and account subset to default values"
        >
          Reset to defaults
        </button>
        {actions}
      </div>

      <details>
        <summary>Account subset ({value.account_ids.length || 'All'})</summary>
        <div className="filters account-filter-tools">
          <input
            placeholder="Search accounts"
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => selectAccountSet([])}
            title="Include all accounts in results"
          >
            All
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => selectAccountSet(accounts.map((a) => a.id))}
            title="Exclude all accounts from results"
          >
            None
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              selectAccountSet(
                accounts
                  .filter(
                    (account) =>
                      !['credit_card', 'credit', 'loan'].includes(account.type)
                  )
                  .map((account) => account.id)
              )
            }
            title="Include checking/savings-style spending accounts and exclude debt accounts"
          >
            Only spending accounts
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              selectAccountSet(
                accounts
                  .filter((account) => account.type.includes('credit'))
                  .map((account) => account.id)
              )
            }
            title="Include only credit card accounts"
          >
            Only credit cards
          </button>
        </div>
        <div className="account-options">
          {filteredAccounts.map((account) => {
            const excluded = value.account_ids.includes(account.id);
            return (
              <label key={account.id} className="inline account-option">
                <input
                  type="checkbox"
                  checked={!excluded}
                  onChange={(e) =>
                    update({
                      account_ids: e.target.checked
                        ? value.account_ids.filter((id) => id !== account.id)
                        : [...value.account_ids, account.id]
                    })
                  }
                />
                {account.name} <small>{account.type}</small>
              </label>
            );
          })}
        </div>
      </details>
    </div>
  );
}
