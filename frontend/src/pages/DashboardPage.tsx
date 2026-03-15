import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts';

import { apiFetch } from '../api';
import type { Account, Category, Transaction } from '../types';
import { buildCategoryPathMap } from '../utils/categories';
import { isLiabilityAccount } from '../utils/accounts';

type SignedBarLabelProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
};

function SignedCurrencyLabel({ x = 0, y = 0, width = 0, height = 0, value = 0 }: SignedBarLabelProps) {
  const label = `$${Math.abs(value).toFixed(0)}`;
  const barEndX = Math.max(x, x + width);
  const labelX = barEndX + 8;

  return (
    <text
      x={labelX}
      y={y + height / 2}
      fill="var(--fg)"
      fontSize={12}
      textAnchor="start"
      dominantBaseline="central"
    >
      {label}
    </text>
  );
}

export function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [includePending, setIncludePending] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    apiFetch<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
    apiFetch<Category[]>('/api/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
    apiFetch<Transaction[]>('/api/transactions?limit=250&include_transfers=0')
      .then(setTransactions)
      .catch(() => setTransactions([]));
  }, []);

  const categoryPathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const netWorth = useMemo(
    () =>
      accounts.reduce((sum, acct) => {
        const balance = Number(acct.balance ?? 0);
        return sum + (isLiabilityAccount(acct) ? -Math.abs(balance) : balance);
      }, 0),
    [accounts]
  );

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthTxns = transactions.filter((txn) =>
    txn.posted_at.startsWith(monthKey)
  );
  const filtered = includePending
    ? monthTxns
    : monthTxns.filter((txn) => !txn.is_pending);

  const inflow = filtered
    .filter((txn) => txn.amount > 0)
    .reduce((s, txn) => s + txn.amount, 0);
  const outflow = filtered
    .filter((txn) => txn.amount < 0)
    .reduce((s, txn) => s + Math.abs(txn.amount), 0);
  const netCashflow = inflow - outflow;

  const spendingByFamily = useMemo(() => {
    const byFamily = new Map<string, number>();
    for (const txn of filtered) {
      if (txn.amount >= 0) continue;
      const path =
        (txn.category_id ? categoryPathMap.get(txn.category_id) : null) ??
        txn.category_name ??
        'Uncategorized';
      const family = path.split(' > ')[0] ?? path;
      byFamily.set(family, (byFamily.get(family) ?? 0) + Math.abs(txn.amount));
    }
    return [...byFamily.entries()]
      .map(([family, amount]) => ({ family, amount: Number(amount.toFixed(2)) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
  }, [filtered, categoryPathMap]);

  const accountBalanceBars = useMemo(
    () =>
      accounts
        .map((acct) => {
          const rawBalance = Number(acct.balance ?? 0);
          const isLiability = isLiabilityAccount(acct);
          return {
            account: acct.name,
            balance: isLiability ? -Math.abs(rawBalance) : rawBalance,
            isLiability
          };
        })
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    [accounts]
  );

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort(
        (a, b) => Math.abs(Number(b.balance ?? 0)) - Math.abs(Number(a.balance ?? 0))
      ),
    [accounts]
  );

  const accountSummary = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    let available = 0;

    for (const acct of accounts) {
      const balance = Number(acct.balance ?? 0);
      const availableBalance = Number(acct.available_balance ?? 0);
      if (isLiabilityAccount(acct)) {
        liabilities += Math.abs(balance);
      } else {
        assets += balance;
        available += availableBalance;
      }
    }

    return {
      assets,
      liabilities,
      net: assets - liabilities,
      available
    };
  }, [accounts]);

  const largestFamilySpend = spendingByFamily[0] ?? null;
  const mortgageSummary = useMemo(
    () =>
      accountBalanceBars
        .filter((row) => row.isLiability && row.account.toLowerCase().includes('mortgage'))
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))[0] ?? null,
    [accountBalanceBars]
  );
  const mobileChartWidth = 560;

  return (
    <section>
      <h2>Home</h2>
      <div className="grid two">
        <article className="card">
          <h3>Spending by Family</h3>
          <p className="category-editor-note">
            Biggest current-month spending groups first.
            {largestFamilySpend ? ` Top family: ${largestFamilySpend.family}.` : ''}
          </p>
          <div className={isMobile ? 'chart-scroll' : ''}>
            <ResponsiveContainer
              width={isMobile ? mobileChartWidth : '100%'}
              height={Math.max(240, spendingByFamily.length * (isMobile ? 36 : 40))}
            >
              <BarChart
                data={spendingByFamily}
                layout="vertical"
                margin={{ top: 8, right: isMobile ? 72 : 20, bottom: 8, left: 4 }}
              >
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                <YAxis
                  type="category"
                  dataKey="family"
                  width={isMobile ? 170 : 110}
                  stroke="var(--fg)"
                  tick={{ fill: 'var(--fg)', fontSize: 12 }}
                />
                <Bar dataKey="amount" fill="var(--series-2)" radius={[8, 8, 8, 8]}>
                  <LabelList dataKey="amount" content={<SignedCurrencyLabel />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="card">
          <h3>Account Balance Bars</h3>
          <p className="category-editor-note">
            Assets stay positive. Loans and credit accounts show as negative.
          </p>
          <div className={isMobile ? 'chart-scroll' : ''}>
            <ResponsiveContainer
              width={isMobile ? mobileChartWidth : '100%'}
              height={Math.max(240, accountBalanceBars.length * (isMobile ? 36 : 40))}
            >
              <BarChart
                data={accountBalanceBars}
                layout="vertical"
                margin={{ top: 8, right: isMobile ? 72 : 20, bottom: 8, left: 4 }}
              >
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                <YAxis
                  type="category"
                  dataKey="account"
                  width={isMobile ? 250 : 180}
                  stroke="var(--fg)"
                  tick={{ fill: 'var(--fg)', fontSize: 12 }}
                />
                <Bar dataKey="balance" radius={[8, 8, 8, 8]}>
                  <LabelList dataKey="balance" content={<SignedCurrencyLabel />} />
                  {accountBalanceBars.map((row) => (
                    <Cell
                      key={row.account}
                      fill={row.isLiability ? 'var(--danger)' : 'var(--series-5)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
      <div className="card">
        <div className="split">
          <div>
            <h3>Monthly Snapshot</h3>
            <p className="category-editor-note">
              Current month totals with {includePending ? 'pending included' : 'posted only'}.
            </p>
          </div>
          <label className="inline">
            <input
              type="checkbox"
              checked={includePending}
              onChange={(e) => setIncludePending(e.target.checked)}
            />
            Include pending
          </label>
        </div>
        <div className="grid four">
          <article className="card">
            <h3>Net Worth</h3>
            <p className="big">${netWorth.toFixed(2)}</p>
          </article>
          <article className="card">
            <h3>Spent This Month</h3>
            <p className="big">${outflow.toFixed(2)}</p>
            <p className="category-editor-note">Income: ${inflow.toFixed(2)}</p>
          </article>
          <article className="card">
            <h3>Net Cashflow</h3>
            <p className="big">${netCashflow.toFixed(2)}</p>
            <p className="category-editor-note">
              {netCashflow >= 0 ? 'Positive month so far' : 'Outflows are ahead of inflows'}
            </p>
          </article>
          <article className="card">
            <h3>Mortgage Balance</h3>
            {mortgageSummary ? (
              <>
                <p className="big">${Math.abs(mortgageSummary.balance).toFixed(2)}</p>
                <p className="category-editor-note">
                  {mortgageSummary.account}
                </p>
              </>
            ) : (
              <p className="category-editor-note">No mortgage account detected.</p>
            )}
          </article>
        </div>
      </div>
      <article className="card">
        <h3>Accounts Snapshot</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Balance</th>
                <th>Available</th>
                <th>Last Sync</th>
              </tr>
            </thead>
            <tbody>
              {sortedAccounts.map((acct) => (
                <tr key={acct.id}>
                  <td>{acct.name}</td>
                  <td>${(acct.balance ?? 0).toFixed(2)}</td>
                  <td>${(acct.available_balance ?? 0).toFixed(2)}</td>
                  <td>
                    {acct.last_sync_at
                      ? new Date(acct.last_sync_at).toLocaleString()
                      : 'never'}
                  </td>
                </tr>
              ))}
              <tr>
                <td><strong>Totals</strong></td>
                <td>
                  <strong>${accountSummary.net.toFixed(2)}</strong>
                  <div className="category-editor-note">
                    Assets ${accountSummary.assets.toFixed(2)} / Liabilities ${accountSummary.liabilities.toFixed(2)}
                  </div>
                </td>
                <td>
                  <strong>${accountSummary.available.toFixed(2)}</strong>
                </td>
                <td className="category-editor-note">Net / available summary</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
