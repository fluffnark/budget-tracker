import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  LabelList,
  Legend,
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
import { isLiabilityAccount } from '../utils/accounts';

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

export function AnalyticsPage() {
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
  const [sankeyMode, setSankeyMode] = useState('account_to_grouped_category');

  const [utilityInflation, setUtilityInflation] = useState(4);
  const [generalInflation, setGeneralInflation] = useState(3);
  const [savingsApr, setSavingsApr] = useState(4.5);
  const [mortgageAccountId, setMortgageAccountId] = useState('');
  const [mortgagePrincipal, setMortgagePrincipal] = useState(0);
  const [mortgageRate, setMortgageRate] = useState(0);
  const [mortgageYears, setMortgageYears] = useState(0);
  const [mortgagePayment, setMortgagePayment] = useState(0);
  const [mortgageExtra, setMortgageExtra] = useState(0);
  const [mortgageMonths, setMortgageMonths] = useState(360);
  const [mortgageOriginalPrincipal, setMortgageOriginalPrincipal] = useState(0);
  const [autoSyncMortgageFromAccount, setAutoSyncMortgageFromAccount] =
    useState(true);
  const [sankeyCategoryIds, setSankeyCategoryIds] = useState<string[]>([]);
  const [sankeyPickerValue, setSankeyPickerValue] = useState('');
  const [sankeySearch, setSankeySearch] = useState('');
  const [sankeyMaxCategoriesPerGroup, setSankeyMaxCategoriesPerGroup] = useState(6);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  async function load() {
    const focusedTransferCategory = sankeyCategoryIds.some((value) => {
      const category = categories.find((entry) => String(entry.id) === value);
      return category?.system_kind === 'transfer';
    });
    const effectiveIncludeTransfers = includeTransfers || focusedTransferCategory;
    const params = new URLSearchParams({
      start,
      end,
      include_pending: includePending ? '1' : '0',
      include_transfers: effectiveIncludeTransfers ? '1' : '0',
      mode: sankeyMode,
      max_categories_per_group: String(sankeyMaxCategoriesPerGroup)
    });
    if (sankeyMode !== 'income_hub_outcomes') {
      for (const categoryId of sankeyCategoryIds) {
        if (categoryId) params.append('category_ids', categoryId);
      }
    }
    const sankeyData = await apiFetch<SankeyData>(
      `/api/analytics/sankey?${params.toString()}`
    );
    setSankeyRaw(sankeyData);

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const monthly = await apiFetch<MonthlyData>(
      `/api/reports/monthly?year=${year}&month=${month}&include_pending=${includePending ? 1 : 0}&include_transfers=${effectiveIncludeTransfers ? 1 : 0}`
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

    if (mortgagePrincipal > 0 && mortgageRate > 0 && mortgageYears > 0) {
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
    } else {
      setMortgageProjection(null);
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
      isLiabilityAccount(account)
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
  }, [accounts, mortgageAccountId, autoSyncMortgageFromAccount]);

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
    categories,
    sankeyCategoryIds,
    sankeyMaxCategoriesPerGroup,
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

  const categoryPathLabel = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    const cache = new Map<number, string>();
    const buildPath = (categoryId: number): string => {
      const cached = cache.get(categoryId);
      if (cached) return cached;
      const category = byId.get(categoryId);
      if (!category) return 'Unknown';
      const label =
        category.parent_id && byId.has(category.parent_id)
          ? `${buildPath(category.parent_id)} > ${category.name}`
          : category.name;
      cache.set(categoryId, label);
      return label;
    };
    return new Map(
      categories.map((category) => [
        category.id,
        `${category.icon ? `${category.icon} ` : ''}${buildPath(category.id)}`
      ])
    );
  }, [categories]);

  const focusedCategorySummary = useMemo(() => {
    return sankeyCategoryIds
      .map((value) => categoryPathLabel.get(Number(value)))
      .filter((value): value is string => Boolean(value));
  }, [categoryPathLabel, sankeyCategoryIds]);

  const filteredCategoryOptions = useMemo(() => {
    const search = sankeySearch.trim().toLowerCase();
    return categories
      .filter((category) => !sankeyCategoryIds.includes(String(category.id)))
      .filter((category) => {
        if (!search) return true;
        const path = categoryPathLabel.get(category.id)?.toLowerCase() ?? category.name.toLowerCase();
        return path.includes(search) || category.system_kind.toLowerCase().includes(search);
      })
      .slice(0, 80);
  }, [categories, sankeyCategoryIds, sankeySearch, categoryPathLabel]);

  const sankeyPresetGroups = useMemo(() => {
    const findMatching = (terms: string[]) =>
      categories
        .filter((category) => {
          const path = (categoryPathLabel.get(category.id) ?? category.name).toLowerCase();
          return terms.some((term) => path.includes(term));
        })
        .map((category) => String(category.id));

    return [
      { label: 'Mortgage', ids: findMatching(['mortgage']) },
      { label: 'Transfers', ids: findMatching(['transfer']) },
      { label: 'Savings', ids: findMatching(['savings', 'roth', 'investment']) },
      { label: 'Utilities', ids: findMatching(['utilities']) },
    ].filter((preset) => preset.ids.length > 0);
  }, [categories, categoryPathLabel]);

  function addSankeyCategory(categoryId: string) {
    if (!categoryId || sankeyCategoryIds.includes(categoryId)) return;
    setSankeyCategoryIds((prev) => [...prev, categoryId]);
    setSankeyPickerValue('');
  }

  function removeSankeyCategory(categoryId: string) {
    setSankeyCategoryIds((prev) => prev.filter((value) => value !== categoryId));
  }

  function addSankeyPreset(ids: string[]) {
    setSankeyCategoryIds((prev) => [...new Set([...prev, ...ids])]);
  }

  const accountBalanceRows = useMemo(() => {
    return accounts
      .map((account) => {
        const rawBalance = Number(account.balance ?? 0);
        const isLiability = isLiabilityAccount(account);
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
  }, [accounts]);

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
  const observedMonthlyPayment = useMemo(() => {
    const paymentRows = monthlyPaymentRows.filter((row) => row.payment_amount > 0);
    if (!paymentRows.length) return 0;
    return (
      paymentRows.reduce((sum, row) => sum + row.payment_amount, 0) / paymentRows.length
    );
  }, [monthlyPaymentRows]);

  const mortgageRequiredFields = useMemo(() => {
    const missing: string[] = [];
    if (!mortgageAccountId) missing.push('mortgage account');
    if (mortgagePrincipal <= 0) missing.push('current balance');
    if (mortgageRate <= 0) missing.push('interest rate');
    if (mortgageYears <= 0) missing.push('years remaining');
    return missing;
  }, [mortgageAccountId, mortgagePrincipal, mortgageRate, mortgageYears]);

  const mortgageRecommendedFields = useMemo(() => {
    const missing: string[] = [];
    if (mortgageOriginalPrincipal <= 0) missing.push('original principal');
    if (mortgagePayment <= 0 && observedMonthlyPayment <= 0) {
      missing.push('monthly payment');
    }
    return missing;
  }, [mortgageOriginalPrincipal, mortgagePayment, observedMonthlyPayment]);
  const mobileChartWidth = 560;

  return (
    <SectionLayout
      pageKey="analytics_v2"
      title="Analytics Studio"
      expandAllByDefault={false}
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
                  <option value="account_to_grouped_category">
                    Accounts → Groups → Categories (Recommended)
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
                Find categories to focus
                <input
                  type="search"
                  value={sankeySearch}
                  onChange={(e) => setSankeySearch(e.target.value)}
                  placeholder="Search mortgage, transfers, roth, utilities..."
                />
                <small>
                  Add parent families or leaves. Parent selections include child categories.
                </small>
              </label>
              <div className="sankey-focus-picker">
                <label>
                  Add focused category
                  <select
                    value={sankeyPickerValue}
                    onChange={(e) => setSankeyPickerValue(e.target.value)}
                  >
                    <option value="">Select category path</option>
                    {filteredCategoryOptions.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {categoryPathLabel.get(cat.id) ?? cat.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => addSankeyCategory(sankeyPickerValue)}
                  disabled={!sankeyPickerValue}
                >
                  Add focus
                </button>
              </div>
              {sankeyPresetGroups.length > 0 && (
                <div className="sankey-presets">
                  {sankeyPresetGroups.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="secondary"
                      onClick={() => addSankeyPreset(preset.ids)}
                    >
                      Focus {preset.label}
                    </button>
                  ))}
                </div>
              )}
              <label>
                Detail depth per group
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={sankeyMaxCategoriesPerGroup}
                  onChange={(e) =>
                    setSankeyMaxCategoriesPerGroup(Number(e.target.value))
                  }
                />
                <small>
                  Show up to {sankeyMaxCategoriesPerGroup} final categories per middle
                  group before collapsing the rest into `Other`.
                </small>
              </label>
              {focusedCategorySummary.length > 0 && (
                <>
                  <div className="sankey-focus-chips">
                    {sankeyCategoryIds.map((categoryId) => (
                      <button
                        key={categoryId}
                        type="button"
                        className="sankey-focus-chip"
                        onClick={() => removeSankeyCategory(categoryId)}
                      >
                        <span>{categoryPathLabel.get(Number(categoryId)) ?? categoryId}</span>
                        <strong>×</strong>
                      </button>
                    ))}
                  </div>
                  <div className="row-actions">
                    <p className="category-editor-note">
                      Focused on {focusedCategorySummary.length} categories.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSankeyCategoryIds([])}
                    >
                      Clear category focus
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        },
        {
          id: 'analytics-share',
          label: 'Category Share',
          content: (
            <div className={isMobile ? 'chart-scroll' : ''}>
            <ResponsiveContainer width={isMobile ? mobileChartWidth : '100%'} height={Math.max(280, pie.length * 42)}>
              <BarChart
                data={[...pie].sort((a, b) => b.amount - a.amount).slice(0, 10)}
                layout="vertical"
                margin={{ top: 8, right: isMobile ? 72 : 22, bottom: 8, left: 12 }}
              >
                <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={isMobile ? 190 : 140}
                  stroke="var(--fg)"
                  tick={{ fill: 'var(--fg)', fontSize: 12 }}
                />
                <Tooltip {...tooltipStyle} cursor={false} />
                <Bar dataKey="amount" name="Spend">
                  <LabelList dataKey="amount" content={<SignedCurrencyLabel />} />
                  {[...pie].sort((a, b) => b.amount - a.amount).slice(0, 10).map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={categoryStyle.get(entry.category)?.color || 'var(--series-1)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          )
        },
        {
          id: 'analytics-account-balances',
          label: 'Account Balances Snapshot',
          content: (
            <div className={isMobile ? 'chart-scroll' : ''}>
            <ResponsiveContainer width={isMobile ? 620 : '100%'} height={340}>
              <BarChart
                data={accountBalanceRows}
                layout="vertical"
                margin={{ top: 8, right: isMobile ? 72 : 18, bottom: 8, left: 18 }}
              >
                <CartesianGrid
                  stroke="var(--text-subtle)"
                  strokeDasharray="3 3"
                />
                <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                <YAxis
                  type="category"
                  dataKey="account"
                  width={isMobile ? 250 : 320}
                  stroke="var(--fg)"
                  tick={{ fill: 'var(--fg)' }}
                />
                <Tooltip {...tooltipStyle} />
                {!isMobile && <Legend formatter={legendFormatter} />}
                <Bar dataKey="signed_balance" name="Net balance">
                  <LabelList dataKey="signed_balance" content={<SignedCurrencyLabel />} />
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
            </div>
          )
        },
        {
          id: 'analytics-assets-liabilities',
          label: 'Assets vs Liabilities',
          content: (
            <div className="grid two">
              <div className={isMobile ? 'chart-scroll' : ''}>
              <ResponsiveContainer width={isMobile ? mobileChartWidth : '100%'} height={280}>
                <BarChart
                  data={assetLiabilityTotals}
                  layout="vertical"
                  margin={{ top: 8, right: isMobile ? 72 : 18, bottom: 8, left: 18 }}
                >
                  <CartesianGrid
                    stroke="var(--text-subtle)"
                    strokeDasharray="3 3"
                    horizontal={false}
                  />
                  <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={isMobile ? 120 : 110}
                    stroke="var(--fg)"
                    tick={{ fill: 'var(--fg)' }}
                  />
                  <Tooltip {...tooltipStyle} cursor={false} />
                  <Bar dataKey="amount" name="Balance">
                    {assetLiabilityTotals.map((row) => (
                      <Cell
                        key={row.name}
                        fill={row.name === 'Liabilities' ? 'var(--danger)' : 'var(--series-5)'}
                      />
                    ))}
                    <LabelList dataKey="amount" content={<SignedCurrencyLabel />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              <div className={isMobile ? 'chart-scroll' : ''}>
              <ResponsiveContainer width={isMobile ? 620 : '100%'} height={280}>
                <BarChart
                  data={debtRows}
                  layout="vertical"
                  margin={{ top: 8, right: isMobile ? 72 : 18, bottom: 8, left: 18 }}
                >
                  <CartesianGrid
                    stroke="var(--text-subtle)"
                    strokeDasharray="3 3"
                  />
                  <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                  <YAxis
                    type="category"
                    dataKey="account"
                    width={isMobile ? 250 : 320}
                    stroke="var(--fg)"
                    tick={{ fill: 'var(--fg)' }}
                  />
                  <Tooltip {...tooltipStyle} cursor={false} />
                  <Bar dataKey="debt" name="Debt balance" fill="var(--danger)">
                    <LabelList dataKey="debt" content={<SignedCurrencyLabel />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          )
        },
        {
          id: 'analytics-sankey',
          label: 'Sankey Flow',
          defaultCollapsed: true,
          content: (
            <ExpandableChart
              label="Sankey Flow"
              height={520}
              expandedHeight={1080}
            >
              {(height, expanded) => (
                <SankeyChart
                  nodes={sankeyRaw.nodes}
                  links={sankeyRaw.links}
                  height={height}
                  width={focusedCategorySummary.length > 0 ? 980 : 1200}
                  expanded={expanded}
                  focused={focusedCategorySummary.length > 0}
                />
              )}
            </ExpandableChart>
          )
        },
        {
          id: 'analytics-balance-trends',
          label: 'Net Worth & Balance Trends',
          defaultCollapsed: true,
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
                  {!isMobile && <Legend formatter={legendFormatter} />}
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
                  {!isMobile && <Legend formatter={legendFormatter} />}
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
                      .filter((account) => isLiabilityAccount(account))
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
                    placeholder="Required"
                    value={mortgageRate}
                    onChange={(e) => setMortgageRate(Number(e.target.value))}
                  />
                </label>
                <label>
                  Years remaining
                  <input
                    type="number"
                    placeholder="Required"
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
              <div className="grid two">
                <article className="card">
                  <h3>Prediction Inputs</h3>
                  <p className="category-editor-note">
                    Current balance is pulled from the selected account when sync is on.
                  </p>
                  <p className="category-editor-note">
                    Required: {mortgageRequiredFields.length ? mortgageRequiredFields.join(', ') : 'ready to run'}
                  </p>
                  <p className="category-editor-note">
                    Recommended: {mortgageRecommendedFields.length ? mortgageRecommendedFields.join(', ') : 'none'}
                  </p>
                  {observedMonthlyPayment > 0 && mortgagePayment <= 0 && (
                    <p className="category-editor-note">
                      Observed average payment in selected range: <strong>${observedMonthlyPayment.toFixed(2)}</strong>
                    </p>
                  )}
                </article>
                <article className="card">
                  <h3>Selected Mortgage Account</h3>
                  {mortgageAccountId ? (
                    <>
                      <p className="category-editor-note">
                        Current balance: <strong>${mortgagePrincipal.toFixed(2)}</strong>
                      </p>
                      <p className="category-editor-note">
                        Turn off sync only if you need to override the live account balance.
                      </p>
                    </>
                  ) : (
                    <p className="category-editor-note">
                      Select the mortgage account first to auto-fill the current balance and load observed payment history.
                    </p>
                  )}
                </article>
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
                        {!isMobile && <Legend formatter={legendFormatter} />}
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
                        {!isMobile && <Legend formatter={legendFormatter} />}
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
                        {!isMobile && <Legend formatter={legendFormatter} />}
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
                        {!isMobile && <Legend formatter={legendFormatter} />}
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
              {!mortgageProjection && mortgageRequiredFields.length > 0 && (
                <p className="category-editor-note">
                  Mortgage projection will appear after the required fields are filled in.
                </p>
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
