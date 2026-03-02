import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { apiFetch } from '../api';
import { ExpandableChart } from '../components/ExpandableChart';
import { SankeyChart } from '../components/SankeyChart';
import { SectionLayout } from '../components/SectionLayout';
import type { Account, Category } from '../types';

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
type Projection = {
  baseline_utilities_monthly: number;
  baseline_total_monthly: number;
  months: {
    month: number;
    projected_utilities: number;
    projected_total_spend: number;
    projected_savings: number;
  }[];
};

type MonthlyData = {
  category_breakdown: { category: string; amount: number }[];
};

type BalanceTrends = {
  accounts: {
    account_id: string;
    name: string;
    type: string;
    source_type: string;
    is_liability: boolean;
    points: { date: string; balance: number }[];
  }[];
  points: {
    date: string;
    assets: number;
    liabilities: number;
    net_worth: number;
  }[];
};

type MortgageProjection = {
  baseline: {
    month: number;
    balance: number;
    payment: number;
    interest: number;
    principal: number;
    cumulative_interest: number;
  }[];
  with_extra: {
    month: number;
    balance: number;
    payment: number;
    interest: number;
    principal: number;
    cumulative_interest: number;
  }[];
  summary: {
    monthly_payment: number;
    monthly_payment_with_extra: number;
    months_baseline: number;
    months_with_extra: number;
    interest_baseline: number;
    interest_with_extra: number;
    interest_saved: number;
  };
};

type MortgageActivity = {
  monthly: {
    month: string;
    payment_amount: number;
    charge_amount: number;
    net_change: number;
  }[];
  snapshot_points: {
    date: string;
    balance: number;
  }[];
  transaction_count: number;
  snapshot_count: number;
};

export function AnalyticsPage() {
  const liabilityTypes = useMemo(
    () =>
      new Set([
        'credit',
        'credit_card',
        'loan',
        'mortgage',
        'liability',
        'debt'
      ]),
    []
  );
  const tooltipStyle = useMemo(
    () => ({
      contentStyle: {
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        color: 'var(--fg)'
      },
      labelStyle: { color: 'var(--fg)' },
      itemStyle: { color: 'var(--fg)' }
    }),
    []
  );
  const legendFormatter = (value: string) => (
    <span style={{ color: 'var(--fg)' }}>{value}</span>
  );

  const [start, setStart] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .slice(0, 10)
  );
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [includePending, setIncludePending] = useState(true);
  const [includeTransfers, setIncludeTransfers] = useState(false);
  const [sankeyRaw, setSankeyRaw] = useState<SankeyData>({ nodes: [], links: [] });
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pie, setPie] = useState<{ category: string; amount: number }[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [balanceTrends, setBalanceTrends] = useState<BalanceTrends | null>(null);
  const [mortgageProjection, setMortgageProjection] =
    useState<MortgageProjection | null>(null);
  const [mortgageActivity, setMortgageActivity] = useState<MortgageActivity | null>(null);
  const [sankeyMode, setSankeyMode] = useState('income_hub_outcomes');
  const [sankeyCategory, setSankeyCategory] = useState('');

  const [utilityInflation, setUtilityInflation] = useState(4);
  const [generalInflation, setGeneralInflation] = useState(3);
  const [savingsApr, setSavingsApr] = useState(4.5);
  const [mortgageAccountId, setMortgageAccountId] = useState('');
  const [mortgagePrincipal, setMortgagePrincipal] = useState(250000);
  const [mortgageRate, setMortgageRate] = useState(6.5);
  const [mortgageYears, setMortgageYears] = useState(30);
  const [mortgagePayment, setMortgagePayment] = useState(0);
  const [mortgageExtra, setMortgageExtra] = useState(0);
  const [mortgageMonths, setMortgageMonths] = useState(360);
  const [mortgageOriginalPrincipal, setMortgageOriginalPrincipal] = useState(0);
  const [autoSyncMortgageFromAccount, setAutoSyncMortgageFromAccount] =
    useState(true);

  async function load() {
    const params = new URLSearchParams({
      start,
      end,
      include_pending: includePending ? '1' : '0',
      include_transfers: includeTransfers ? '1' : '0',
      mode: sankeyMode
    });
    if (sankeyCategory && sankeyMode !== 'income_hub_outcomes') {
      params.set('category_id', sankeyCategory);
    }
    const sankeyData = await apiFetch<SankeyData>(
      `/api/analytics/sankey?${params.toString()}`
    );
    setSankeyRaw(sankeyData);

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const monthly = await apiFetch<MonthlyData>(
      `/api/reports/monthly?year=${year}&month=${month}&include_pending=${includePending ? 1 : 0}&include_transfers=${includeTransfers ? 1 : 0}`
    );
    setPie(monthly.category_breakdown);

    const proj = await apiFetch<Projection>(
      `/api/analytics/projections?utility_inflation_rate=${utilityInflation}&general_inflation_rate=${generalInflation}&savings_apr=${savingsApr}`
    );
    setProjection(proj);

    const trends = await apiFetch<BalanceTrends>(
      `/api/analytics/balance_trends?start=${start}&end=${end}`
    );
    setBalanceTrends(trends);

    if (mortgagePrincipal > 0) {
      const mortgageParams = new URLSearchParams({
        principal_balance: String(mortgagePrincipal),
        annual_interest_rate: String(mortgageRate),
        years_remaining: String(mortgageYears),
        extra_payment: String(mortgageExtra),
        months_to_project: String(mortgageMonths)
      });
      if (mortgagePayment > 0) {
        mortgageParams.set('monthly_payment', String(mortgagePayment));
      }
      const mortgage = await apiFetch<MortgageProjection>(
        `/api/analytics/mortgage_projection?${mortgageParams.toString()}`
      );
      setMortgageProjection(mortgage);

      if (mortgageAccountId) {
        const activity = await apiFetch<MortgageActivity>(
          `/api/analytics/mortgage_activity?account_id=${encodeURIComponent(
            mortgageAccountId
          )}&start=${start}&end=${end}`
        );
        setMortgageActivity(activity);
      } else {
        setMortgageActivity(null);
      }
    } else {
      setMortgageProjection(null);
      setMortgageActivity(null);
    }
  }

  useEffect(() => {
    apiFetch<Category[]>('/api/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
    apiFetch<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    const liabilities = accounts.filter((account) =>
      liabilityTypes.has(account.type.toLowerCase())
    );
    if (!liabilities.length) return;

    const preferred =
      liabilities.find((account) => {
        const name = account.name.toLowerCase();
        return (
          (name.includes('bank of albuquerque') || name.includes('bok')) &&
          name.includes('mortgage')
        );
      }) ||
      liabilities.find((account) =>
        account.name.toLowerCase().includes('mortgage')
      ) ||
      liabilities[0];

    const selected =
      liabilities.find((account) => account.id === mortgageAccountId) || preferred;
    if (!selected) return;

    setMortgageAccountId(selected.id);
    if (autoSyncMortgageFromAccount && selected.balance !== null) {
      const current = Math.abs(Number(selected.balance));
      setMortgagePrincipal(current);
      setMortgageOriginalPrincipal((prev) => (prev > 0 ? prev : current));
    }
  }, [accounts, mortgageAccountId, autoSyncMortgageFromAccount, liabilityTypes]);

  useEffect(() => {
    load().catch(() => {
      setSankeyRaw({ nodes: [], links: [] });
      setPie([]);
      setProjection(null);
    });
  }, [
    start,
    end,
    includePending,
    includeTransfers,
    sankeyMode,
    sankeyCategory,
    utilityInflation,
    generalInflation,
    savingsApr,
    mortgagePrincipal,
    mortgageRate,
    mortgageYears,
    mortgagePayment,
    mortgageExtra,
    mortgageMonths,
    mortgageAccountId
  ]);

  const categoryStyle = useMemo(() => {
    const map = new Map<string, { color: string; icon: string }>();
    for (const cat of categories) {
      map.set(cat.name, {
        color: cat.color || 'var(--series-2)',
        icon: cat.icon || ''
      });
    }
    return map;
  }, [categories]);

  const accountBalanceRows = useMemo(() => {
    return accounts
      .map((account) => {
        const rawBalance = Number(account.balance ?? 0);
        const isLiability = liabilityTypes.has(account.type.toLowerCase());
        const signedBalance = isLiability ? -Math.abs(rawBalance) : rawBalance;
        return {
          account: account.name,
          type: account.type,
          source_type: account.source_type,
          isLiability,
          balance: rawBalance,
          signed_balance: signedBalance,
          abs_balance: Math.abs(rawBalance)
        };
      })
      .sort((a, b) => Math.abs(b.signed_balance) - Math.abs(a.signed_balance));
  }, [accounts, liabilityTypes]);

  const assetLiabilityTotals = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const row of accountBalanceRows) {
      if (row.isLiability) liabilities += Math.abs(row.balance);
      else assets += Math.max(0, row.balance);
    }
    return [
      { name: 'Assets', amount: Number(assets.toFixed(2)) },
      { name: 'Liabilities', amount: Number(liabilities.toFixed(2)) }
    ];
  }, [accountBalanceRows]);

  const debtRows = useMemo(
    () =>
      accountBalanceRows
        .filter((row) => row.isLiability)
        .map((row) => ({
          account: row.account,
          debt: Math.abs(row.balance)
        }))
        .sort((a, b) => b.debt - a.debt),
    [accountBalanceRows]
  );

  const balanceTrendRows = useMemo(() => balanceTrends?.points ?? [], [balanceTrends]);

  const topTrendAccounts = useMemo(() => {
    const rows = balanceTrends?.accounts ?? [];
    return [...rows]
      .sort((a, b) => {
        const aLast = a.points[a.points.length - 1]?.balance ?? 0;
        const bLast = b.points[b.points.length - 1]?.balance ?? 0;
        return Math.abs(bLast) - Math.abs(aLast);
      })
      .slice(0, 8);
  }, [balanceTrends]);

  const accountTrendData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const account of topTrendAccounts) {
      for (const point of account.points) {
        const row = byDate.get(point.date) ?? { date: point.date };
        row[account.name] = point.balance;
        byDate.set(point.date, row);
      }
    }
    return [...byDate.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
  }, [topTrendAccounts]);

  const mortgageChartRows = useMemo(() => {
    if (!mortgageProjection) return [];
    const maxMonths = Math.max(
      mortgageProjection.baseline.length,
      mortgageProjection.with_extra.length
    );
    const rows: Array<Record<string, number>> = [];
    for (let i = 0; i < maxMonths; i += 1) {
      const base = mortgageProjection.baseline[i];
      const extra = mortgageProjection.with_extra[i];
      rows.push({
        month: i + 1,
        baseline_balance: base?.balance ?? 0,
        extra_balance: extra?.balance ?? 0,
        baseline_interest: base?.cumulative_interest ?? (rows[i - 1]?.baseline_interest ?? 0),
        extra_interest: extra?.cumulative_interest ?? (rows[i - 1]?.extra_interest ?? 0)
      });
    }
    return rows;
  }, [mortgageProjection]);

  const paidPrincipal = useMemo(() => {
    if (mortgageOriginalPrincipal <= 0) return 0;
    return Math.max(0, mortgageOriginalPrincipal - mortgagePrincipal);
  }, [mortgageOriginalPrincipal, mortgagePrincipal]);

  const principalProgressPct = useMemo(() => {
    if (mortgageOriginalPrincipal <= 0) return 0;
    return Math.min(100, (paidPrincipal / mortgageOriginalPrincipal) * 100);
  }, [paidPrincipal, mortgageOriginalPrincipal]);

  const monthlyPaymentRows = useMemo(() => mortgageActivity?.monthly ?? [], [mortgageActivity]);

  return (
    <SectionLayout
      pageKey="analytics"
      title="Analytics Studio"
      sections={[
        {
          id: 'analytics-controls',
          label: 'Controls',
          content: (
            <div className="filters">
              <label>
                Start
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                End
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={includePending}
                  onChange={(e) => setIncludePending(e.target.checked)}
                />
                Include pending
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={includeTransfers}
                  onChange={(e) => setIncludeTransfers(e.target.checked)}
                />
                Include transfers
              </label>
              <label>
                Sankey mode
                <select
                  value={sankeyMode}
                  onChange={(e) => setSankeyMode(e.target.value)}
                >
                  <option value="income_hub_outcomes">
                    Income → Cash hubs → Outcomes (Recommended)
                  </option>
                  <option value="account_to_category">
                    Accounts → Categories
                  </option>
                  <option value="category_to_account">
                    Categories → Accounts
                  </option>
                </select>
              </label>
              <label>
                Category focus
                <select
                  value={sankeyCategory}
                  disabled={sankeyMode === 'income_hub_outcomes'}
                  onChange={(e) => setSankeyCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {(cat.icon ? `${cat.icon} ` : '') + cat.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        },
        {
          id: 'analytics-sankey',
          label: 'Sankey Flow',
          content: (
            <ExpandableChart
              label="Sankey Flow"
              height={420}
              expandedHeight={920}
            >
              {(height, expanded) => (
                <SankeyChart
                  nodes={sankeyRaw.nodes}
                  links={sankeyRaw.links}
                  height={height}
                  width={expanded ? 1800 : 1200}
                />
              )}
            </ExpandableChart>
          )
        },
        {
          id: 'analytics-share',
          label: 'Category Share',
          content: (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pie}
                  dataKey="amount"
                  nameKey="category"
                  outerRadius={100}
                  fill="var(--series-1)"
                >
                  {pie.map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={
                        categoryStyle.get(entry.category)?.color ||
                        'var(--series-1)'
                      }
                    />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )
        },
        {
          id: 'analytics-account-balances',
          label: 'Account Balances Snapshot',
          content: (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart
                data={accountBalanceRows}
                layout="vertical"
                margin={{ top: 8, right: 18, bottom: 8, left: 18 }}
              >
                <CartesianGrid
                  stroke="var(--text-subtle)"
                  strokeDasharray="3 3"
                />
                <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                <YAxis
                  type="category"
                  dataKey="account"
                  width={320}
                  stroke="var(--fg)"
                  tick={{ fill: 'var(--fg)' }}
                />
                <Tooltip {...tooltipStyle} />
                <Legend formatter={legendFormatter} />
                <Bar dataKey="signed_balance" name="Net balance">
                  {accountBalanceRows.map((row) => (
                    <Cell
                      key={`${row.account}-${row.type}`}
                      fill={
                        row.isLiability ? 'var(--danger)' : 'var(--series-5)'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )
        },
        {
          id: 'analytics-assets-liabilities',
          label: 'Assets vs Liabilities',
          content: (
            <div className="grid two">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={assetLiabilityTotals}
                    dataKey="amount"
                    nameKey="name"
                    outerRadius={95}
                  >
                    <Cell fill="var(--series-5)" />
                    <Cell fill="var(--danger)" />
                  </Pie>
                  <Tooltip {...tooltipStyle} cursor={false} />
                </PieChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={debtRows}
                  layout="vertical"
                  margin={{ top: 8, right: 18, bottom: 8, left: 18 }}
                >
                  <CartesianGrid
                    stroke="var(--text-subtle)"
                    strokeDasharray="3 3"
                  />
                  <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <YAxis
                    type="category"
                    dataKey="account"
                    width={320}
                    stroke="var(--fg)"
                    tick={{ fill: 'var(--fg)' }}
                  />
                  <Tooltip {...tooltipStyle} cursor={false} />
                  <Bar dataKey="debt" name="Debt balance" fill="var(--danger)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )
        },
        {
          id: 'analytics-balance-trends',
          label: 'Net Worth & Balance Trends',
          content: (
            <div className="grid two">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={balanceTrendRows}>
                  <CartesianGrid
                    stroke="var(--text-subtle)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="date" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <Tooltip {...tooltipStyle} />
                  <Legend formatter={legendFormatter} />
                  <Line
                    dataKey="assets"
                    name="Assets"
                    stroke="var(--series-5)"
                    dot={false}
                  />
                  <Line
                    dataKey="liabilities"
                    name="Liabilities"
                    stroke="var(--danger)"
                    dot={false}
                  />
                  <Line
                    dataKey="net_worth"
                    name="Net worth"
                    stroke="var(--series-1)"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={accountTrendData}>
                  <CartesianGrid
                    stroke="var(--text-subtle)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="date" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <Tooltip {...tooltipStyle} />
                  <Legend formatter={legendFormatter} />
                  {topTrendAccounts.map((account, idx) => (
                    <Line
                      key={account.account_id}
                      dataKey={account.name}
                      stroke={`var(--series-${(idx % 5) + 1})`}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        },
        {
          id: 'analytics-mortgage',
          label: 'Mortgage Projections',
          content: (
            <>
              <div className="filters">
                <label>
                  Mortgage account
                  <select
                    value={mortgageAccountId}
                    onChange={(e) => {
                      const accountId = e.target.value;
                      setMortgageAccountId(accountId);
                      const account = accounts.find((item) => item.id === accountId);
                      if (autoSyncMortgageFromAccount && account?.balance != null) {
                        setMortgagePrincipal(Math.abs(Number(account.balance)));
                      }
                    }}
                  >
                    <option value="">Select account</option>
                    {accounts
                      .filter((account) =>
                        ['credit', 'credit_card', 'loan', 'mortgage', 'liability', 'debt'].includes(
                          account.type.toLowerCase()
                        )
                      )
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.type})
                        </option>
                      ))}
                  </select>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={autoSyncMortgageFromAccount}
                    onChange={(e) => setAutoSyncMortgageFromAccount(e.target.checked)}
                  />
                  Sync principal from selected account balance
                </label>
                <label>
                  Principal balance
                  <input
                    type="number"
                    value={mortgagePrincipal}
                    onChange={(e) => setMortgagePrincipal(Number(e.target.value))}
                  />
                </label>
                <label>
                  Original principal (for paid-to-date)
                  <input
                    type="number"
                    value={mortgageOriginalPrincipal}
                    onChange={(e) =>
                      setMortgageOriginalPrincipal(Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Interest rate (% APR)
                  <input
                    type="number"
                    step="0.01"
                    value={mortgageRate}
                    onChange={(e) => setMortgageRate(Number(e.target.value))}
                  />
                </label>
                <label>
                  Years remaining
                  <input
                    type="number"
                    value={mortgageYears}
                    onChange={(e) => setMortgageYears(Number(e.target.value))}
                  />
                </label>
                <label>
                  Monthly payment (optional)
                  <input
                    type="number"
                    value={mortgagePayment}
                    onChange={(e) => setMortgagePayment(Number(e.target.value))}
                  />
                </label>
                <label>
                  Extra payment / month
                  <input
                    type="number"
                    value={mortgageExtra}
                    onChange={(e) => setMortgageExtra(Number(e.target.value))}
                  />
                </label>
                <label>
                  Projection months
                  <input
                    type="number"
                    value={mortgageMonths}
                    onChange={(e) => setMortgageMonths(Number(e.target.value))}
                  />
                </label>
              </div>
              {mortgageProjection && (
                <>
                  <p className="category-editor-note">
                    Principal paid to date:{' '}
                    <strong>
                      {paidPrincipal.toFixed(2)} ({principalProgressPct.toFixed(1)}%)
                    </strong>{' '}
                    | Current balance: <strong>{mortgagePrincipal.toFixed(2)}</strong>{' '}
                    | Original principal:{' '}
                    <strong>{mortgageOriginalPrincipal.toFixed(2)}</strong>
                  </p>
                  <p className="category-editor-note">
                    Payment: {mortgageProjection.summary.monthly_payment.toFixed(2)} | With extra:{' '}
                    {mortgageProjection.summary.monthly_payment_with_extra.toFixed(2)} | Payoff
                    months: {mortgageProjection.summary.months_baseline} →{' '}
                    {mortgageProjection.summary.months_with_extra} | Interest saved:{' '}
                    {mortgageProjection.summary.interest_saved.toFixed(2)}
                  </p>
                  <div className="grid two">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={mortgageChartRows}>
                        <CartesianGrid
                          stroke="var(--text-subtle)"
                          strokeDasharray="3 3"
                        />
                        <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Legend formatter={legendFormatter} />
                        <Line
                          dataKey="baseline_balance"
                          name="Balance (base)"
                          stroke="var(--danger)"
                          dot={false}
                        />
                        <Line
                          dataKey="extra_balance"
                          name="Balance (with extra)"
                          stroke="var(--series-5)"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={mortgageChartRows}>
                        <CartesianGrid
                          stroke="var(--text-subtle)"
                          strokeDasharray="3 3"
                        />
                        <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Legend formatter={legendFormatter} />
                        <Line
                          dataKey="baseline_interest"
                          name="Cumulative interest (base)"
                          stroke="var(--series-2)"
                          dot={false}
                        />
                        <Line
                          dataKey="extra_interest"
                          name="Cumulative interest (with extra)"
                          stroke="var(--series-1)"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid two">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={monthlyPaymentRows}
                        margin={{ top: 8, right: 18, bottom: 8, left: 8 }}
                      >
                        <CartesianGrid
                          stroke="var(--text-subtle)"
                          strokeDasharray="3 3"
                        />
                        <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Legend formatter={legendFormatter} />
                        <Bar
                          dataKey="payment_amount"
                          name="Payments seen"
                          fill="var(--series-5)"
                        />
                        <Bar
                          dataKey="charge_amount"
                          name="Charges seen"
                          fill="var(--danger)"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={mortgageActivity?.snapshot_points ?? []}>
                        <CartesianGrid
                          stroke="var(--text-subtle)"
                          strokeDasharray="3 3"
                        />
                        <XAxis dataKey="date" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Legend formatter={legendFormatter} />
                        <Line
                          dataKey="balance"
                          name="Observed mortgage balance"
                          stroke="var(--series-2)"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {mortgageActivity &&
                    mortgageActivity.transaction_count === 0 &&
                    mortgageActivity.snapshot_count <= 1 && (
                      <p className="category-editor-note">
                        No mortgage payment transactions and only one balance snapshot were synced for this range, so historical monthly payment tracking is limited right now.
                      </p>
                    )}
                </>
              )}
            </>
          )
        },
        {
          id: 'analytics-projection',
          label: 'Projection Knobs',
          defaultCollapsed: true,
          content: (
            <>
              <div className="filters">
                <label>
                  Utility inflation (%/yr)
                  <input
                    type="number"
                    value={utilityInflation}
                    onChange={(e) =>
                      setUtilityInflation(Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  General inflation (%/yr)
                  <input
                    type="number"
                    value={generalInflation}
                    onChange={(e) =>
                      setGeneralInflation(Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Savings APR (%/yr)
                  <input
                    type="number"
                    value={savingsApr}
                    onChange={(e) => setSavingsApr(Number(e.target.value))}
                  />
                </label>
              </div>
              {projection && (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={projection.months}>
                    <CartesianGrid
                      stroke="var(--text-subtle)"
                      strokeDasharray="3 3"
                    />
                    <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                    <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                    <Tooltip {...tooltipStyle} />
                    <Line
                      dataKey="projected_utilities"
                      stroke="var(--series-1)"
                    />
                    <Line
                      dataKey="projected_total_spend"
                      stroke="var(--series-2)"
                    />
                    <Line
                      dataKey="projected_savings"
                      stroke="var(--series-5)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </>
          )
        }
      ]}
    />
  );
}
