import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { apiFetch } from '../api';
import { CategoryWaffleChart } from '../components/CategoryWaffleChart';
import { ExpandableChart } from '../components/ExpandableChart';
import { SankeyChart } from '../components/SankeyChart';
import { SectionLayout } from '../components/SectionLayout';
import type { Account, Category } from '../types';
import { isLiabilityAccount } from '../utils/accounts';
import { buildCategoryPathMap } from '../utils/categories';
import { buildCategoryColorResolver } from '../utils/categoryColors';
import { buildTransactionsHref } from '../utils/transactionsLink';

type WeeklyData = {
  totals: { inflow: number; outflow: number; net: number };
  top_categories: { category: string; amount: number }[];
  daily_outflow: { date: string; label: string; outflow: number }[];
  largest_transactions: { description: string; amount: number; account: string }[];
  utilities: { category: string; amount: number }[];
};

type MonthlyData = {
  totals: { inflow: number; outflow: number; net: number };
  category_breakdown: { category: string; amount: number }[];
  daily_outflow: { date: string; label: string; outflow: number }[];
  mom_deltas: { category: string; current: number; previous: number; delta: number }[];
  utilities: { category: string; amount: number }[];
};

type YearlyData = {
  year: number;
  monthly_totals: { month: number; inflow: number; outflow: number; net: number }[];
  category_trends: { category: string; months: number[] }[];
};

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

type MerchantHistory = {
  start: string;
  end: string;
  bucket: 'week' | 'month';
  top_merchants: {
    merchant: string;
    total: number;
    average_per_bucket: number;
    latest_bucket: number;
    active_buckets: number;
    sparkline: number[];
  }[];
  buckets: {
    bucket_start: string;
    bucket_label: string;
    total: number;
    merchants: Record<string, number>;
  }[];
  top_by_family: {
    family: string;
    merchant: string;
    total: number;
    family_total: number;
    share_of_family: number;
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

function SignedCurrencyLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value = 0
}: SignedBarLabelProps) {
  return (
    <text
      x={Math.max(x, x + width) + 8}
      y={y + height / 2}
      fill="var(--fg)"
      fontSize={12}
      textAnchor="start"
      dominantBaseline="central"
    >
      ${Math.abs(value).toFixed(0)}
    </text>
  );
}

function merchantSeriesColor(index: number): string {
  const palette = ['#5b8ff9', '#f6a35b', '#5ad8a6', '#e8684a', '#6dc8ec', '#9270ca'];
  return palette[index % palette.length];
}

function shiftMonthsForWindow(isoDate: string, months: number, alignToMonthStart: boolean): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCMonth(value.getUTCMonth() - months + 1);
  if (alignToMonthStart) value.setUTCDate(1);
  return value.toISOString().slice(0, 10);
}

function shiftDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shiftMonthWindow(base: Date, monthOffset: number) {
  const value = new Date(Date.UTC(base.getFullYear(), base.getMonth(), 1));
  value.setUTCMonth(value.getUTCMonth() + monthOffset);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + 1;
  return {
    year,
    month,
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  };
}

function spendBucketLabel(bucket: string | null): string {
  if (!bucket) return 'Unbucketed';
  return bucket
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isMortgageAccount(account: Account): boolean {
  return isLiabilityAccount(account) && account.name.toLowerCase().includes('mortgage');
}

export function AnalyticsPage() {
  const navigate = useNavigate();
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

  const now = useMemo(() => new Date(), []);
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const currentYear = now.getFullYear();
  const todayIso = now.toISOString().slice(0, 10);
  const weeklyStartDate = useMemo(() => {
    const value = new Date(now);
    value.setDate(value.getDate() - 6);
    return value.toISOString().slice(0, 10);
  }, [now]);
  const monthStart = `${currentYear}-${currentMonth}-01`;
  const monthEnd = new Date(currentYear, Number(currentMonth), 0)
    .toISOString()
    .slice(0, 10);

  const [start, setStart] = useState(
    new Date(new Date().setDate(new Date().getDate() - 90))
      .toISOString()
      .slice(0, 10)
  );
  const [end, setEnd] = useState(todayIso);
  const [includePending, setIncludePending] = useState(true);
  const [includeTransfers, setIncludeTransfers] = useState(false);
  const [excludeHousing, setExcludeHousing] = useState(true);
  const [weeklyOffset, setWeeklyOffset] = useState(0);
  const [monthlyOffset, setMonthlyOffset] = useState(0);
  const [yearlyOffset, setYearlyOffset] = useState(0);
  const [overviewTab, setOverviewTab] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [sankeyMode, setSankeyMode] = useState('account_to_grouped_category');
  const [sankeyCategoryId, setSankeyCategoryId] = useState('');
  const [sankeyMaxCategoriesPerGroup, setSankeyMaxCategoriesPerGroup] = useState(5);
  const [merchantWindowMonths, setMerchantWindowMonths] = useState(12);
  const [merchantBucket, setMerchantBucket] = useState<'week' | 'month'>('month');
  const [merchantTopN, setMerchantTopN] = useState(8);
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
  const [isMobile, setIsMobile] = useState(false);

  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [yearly, setYearly] = useState<YearlyData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sankeyRaw, setSankeyRaw] = useState<SankeyData>({ nodes: [], links: [] });
  const [projection, setProjection] = useState<Projection | null>(null);
  const [balanceTrends, setBalanceTrends] = useState<BalanceTrends | null>(null);
  const [merchantHistory, setMerchantHistory] = useState<MerchantHistory | null>(null);
  const [mortgageProjection, setMortgageProjection] =
    useState<MortgageProjection | null>(null);
  const [mortgageActivity, setMortgageActivity] = useState<MortgageActivity | null>(null);
  const selectedWeeklyEnd = useMemo(
    () => shiftDays(todayIso, -weeklyOffset * 7),
    [todayIso, weeklyOffset]
  );
  const selectedWeeklyStart = useMemo(
    () => shiftDays(selectedWeeklyEnd, -6),
    [selectedWeeklyEnd]
  );
  const weeklyRangeLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return `${formatter.format(new Date(`${selectedWeeklyStart}T00:00:00Z`))} - ${formatter.format(
      new Date(`${selectedWeeklyEnd}T00:00:00Z`)
    )}`;
  }, [selectedWeeklyEnd, selectedWeeklyStart]);
  const selectedMonthWindow = useMemo(
    () => shiftMonthWindow(now, monthlyOffset),
    [monthlyOffset, now]
  );
  const selectedMonthStart = selectedMonthWindow.start;
  const selectedMonthEnd = selectedMonthWindow.end;
  const selectedMonthYear = selectedMonthWindow.year;
  const selectedMonthNumber = selectedMonthWindow.month;
  const monthlyRangeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric'
      }).format(new Date(`${selectedMonthStart}T00:00:00Z`)),
    [selectedMonthStart]
  );
  const selectedYear = currentYear + yearlyOffset;
  const yearlyRangeStart = `${selectedYear}-01-01`;
  const yearlyRangeEnd = selectedYear === currentYear ? todayIso : `${selectedYear}-12-31`;
  const yearlyRangeLabel = String(selectedYear);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    apiFetch<Category[]>('/api/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
    apiFetch<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    const liabilities = accounts.filter((account) => isLiabilityAccount(account));
    if (!liabilities.length) return;

    const preferred =
      liabilities.find((account) => {
        const name = account.name.toLowerCase();
        return (
          (name.includes('bank of albuquerque') || name.includes('bok')) &&
          name.includes('mortgage')
        );
      }) ||
      liabilities.find((account) => account.name.toLowerCase().includes('mortgage')) ||
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

  async function load() {
    const focusedTransferCategory = categories.find(
      (entry) => String(entry.id) === sankeyCategoryId
    )?.system_kind === 'transfer';
    const effectiveIncludeTransfers = includeTransfers || focusedTransferCategory;

    const sankeyParams = new URLSearchParams({
      start,
      end,
      include_pending: includePending ? '1' : '0',
      include_transfers: effectiveIncludeTransfers ? '1' : '0',
      mode: sankeyMode,
      max_categories_per_group: String(sankeyMaxCategoriesPerGroup)
    });
    if (sankeyMode !== 'income_hub_outcomes') {
      if (sankeyCategoryId) sankeyParams.append('category_ids', sankeyCategoryId);
    }

    const merchantStart = shiftMonthsForWindow(
      end,
      merchantWindowMonths,
      merchantBucket === 'month'
    );
    const merchantParams = new URLSearchParams({
      start: merchantStart,
      end,
      include_pending: includePending ? '1' : '0',
      include_transfers: effectiveIncludeTransfers ? '1' : '0',
      bucket: merchantBucket,
      top_n: String(merchantTopN)
    });

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

    const [
      nextWeekly,
      nextMonthly,
      nextYearly,
      nextSankey,
      nextProjection,
      nextBalanceTrends,
      nextMerchantHistory
    ] = await Promise.all([
      apiFetch<WeeklyData>(
        `/api/reports/weekly?start=${selectedWeeklyStart}&end=${selectedWeeklyEnd}&include_pending=${
          includePending ? 1 : 0
        }&include_transfers=0`
      ),
      apiFetch<MonthlyData>(
        `/api/reports/monthly?year=${selectedMonthYear}&month=${String(selectedMonthNumber).padStart(2, '0')}&include_pending=${
          includePending ? 1 : 0
        }&include_transfers=0`
      ),
      apiFetch<YearlyData>(
        `/api/reports/yearly?year=${selectedYear}&include_pending=${includePending ? 1 : 0}&include_transfers=0`
      ),
      apiFetch<SankeyData>(`/api/analytics/sankey?${sankeyParams.toString()}`),
      apiFetch<Projection>(
        `/api/analytics/projections?utility_inflation_rate=${utilityInflation}&general_inflation_rate=${generalInflation}&savings_apr=${savingsApr}`
      ),
      apiFetch<BalanceTrends>(`/api/analytics/balance_trends?start=${start}&end=${end}`),
      apiFetch<MerchantHistory>(
        `/api/analytics/merchant_history?${merchantParams.toString()}`
      )
    ]);

    setWeekly(nextWeekly);
    setMonthly(nextMonthly);
    setYearly(nextYearly);
    setSankeyRaw(nextSankey);
    setProjection(nextProjection);
    setBalanceTrends(nextBalanceTrends);
    setMerchantHistory(nextMerchantHistory);

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
      const mortgage = await apiFetch<MortgageProjection>(
        `/api/analytics/mortgage_projection?${mortgageParams.toString()}`
      );
      setMortgageProjection(mortgage);
    } else {
      setMortgageProjection(null);
    }
  }

  useEffect(() => {
    load().catch(() => {
      setWeekly(null);
      setMonthly(null);
      setYearly(null);
      setSankeyRaw({ nodes: [], links: [] });
      setProjection(null);
      setBalanceTrends(null);
      setMerchantHistory(null);
      setMortgageProjection(null);
      setMortgageActivity(null);
    });
  }, [
    categories,
    currentMonth,
    currentYear,
    end,
    includePending,
    includeTransfers,
    merchantBucket,
    merchantTopN,
    merchantWindowMonths,
    mortgageAccountId,
    mortgageExtra,
    mortgageMonths,
    mortgagePayment,
    mortgagePrincipal,
    mortgageRate,
    mortgageYears,
    sankeyCategoryId,
    sankeyMaxCategoriesPerGroup,
    sankeyMode,
    start,
    todayIso,
    utilityInflation,
    generalInflation,
    savingsApr,
    selectedMonthNumber,
    selectedMonthYear,
    selectedWeeklyEnd,
    selectedWeeklyStart,
    selectedYear,
    weeklyStartDate
  ]);

  const categoryPathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const categoryIdsByLabel = useMemo(() => {
    const map = new Map<string, number>();
    const leafCounts = new Map<string, number>();
    for (const category of categories) {
      leafCounts.set(category.name, (leafCounts.get(category.name) ?? 0) + 1);
    }
    for (const category of categories) {
      const path = categoryPathMap.get(category.id);
      if (path) map.set(path, category.id);
      if ((leafCounts.get(category.name) ?? 0) === 1) map.set(category.name, category.id);
    }
    return map;
  }, [categories, categoryPathMap]);
  const categoryStyle = useMemo(() => {
    const resolve = buildCategoryColorResolver(categories);
    const map = new Map<string, string>();
    for (const category of categories) {
      const path = categoryPathMap.get(category.id) ?? category.name;
      map.set(path, resolve(path));
      map.set(category.name, resolve(category.name));
    }
    return map;
  }, [categories, categoryPathMap]);
  const getCategoryColor = useMemo(
    () => buildCategoryColorResolver(categories),
    [categories]
  );
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
    return new Map(categories.map((category) => [category.id, buildPath(category.id)]));
  }, [categories]);

  const sankeyCategoryOptions = useMemo(
    () =>
      categories
        .map((category) => ({
          id: String(category.id),
          label: categoryPathLabel.get(category.id) ?? category.name
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories, categoryPathLabel]
  );
  const isExcludedHousingCategory = useMemo(
    () => (label: string) => {
      const categoryId = categoryIdsByLabel.get(label);
      const resolvedPath =
        (categoryId ? categoryPathLabel.get(categoryId) : null) ?? label;
      const normalized = resolvedPath.toLowerCase();
      return (
        normalized.split(' > ')[0] === 'housing' ||
        normalized === 'mortgage' ||
        normalized.endsWith(' > mortgage')
      );
    },
    [categoryIdsByLabel, categoryPathLabel]
  );

  const monthlyCategoryData = useMemo(
    () =>
      [...(monthly?.category_breakdown ?? [])]
        .filter((row) => !(excludeHousing && isExcludedHousingCategory(row.category)))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [excludeHousing, isExcludedHousingCategory, monthly]
  );
  const weeklyCategoryData = useMemo(
    () =>
      [...(weekly?.top_categories ?? [])]
        .filter((row) => !(excludeHousing && isExcludedHousingCategory(row.category)))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [excludeHousing, isExcludedHousingCategory, weekly]
  );
  const yearlyCategoryData = useMemo(
    () =>
      [...(yearly?.category_trends ?? [])]
        .filter((row) => !(excludeHousing && isExcludedHousingCategory(row.category)))
        .map((row) => ({
          category: row.category,
          amount: row.months.reduce((sum, value) => sum + value, 0)
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [excludeHousing, isExcludedHousingCategory, yearly]
  );
  const monthlyChangeData = useMemo(
    () =>
      [...(monthly?.mom_deltas ?? [])]
        .filter((row) => !(excludeHousing && isExcludedHousingCategory(row.category)))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 8),
    [excludeHousing, isExcludedHousingCategory, monthly]
  );
  const yearlyTrendRows = useMemo(() => yearly?.monthly_totals ?? [], [yearly]);
  const yearlyOutflow = useMemo(() => {
    if (!excludeHousing) {
      return yearlyTrendRows.reduce((sum, row) => sum + row.outflow, 0);
    }
    return (yearly?.category_trends ?? [])
      .filter((row) => !isExcludedHousingCategory(row.category))
      .reduce(
        (sum, row) => sum + row.months.reduce((monthSum, value) => monthSum + value, 0),
        0
      );
  }, [excludeHousing, isExcludedHousingCategory, yearly, yearlyTrendRows]);
  const balanceTrendRows = useMemo(() => balanceTrends?.points ?? [], [balanceTrends]);
  const merchantLeaderboardRows = useMemo(
    () => merchantHistory?.top_merchants ?? [],
    [merchantHistory]
  );
  const merchantTrendSeries = useMemo(
    () =>
      merchantLeaderboardRows
        .slice(0, Math.min(5, merchantLeaderboardRows.length))
        .map((row) => row.merchant),
    [merchantLeaderboardRows]
  );
  const merchantTrendRows = useMemo(
    () =>
      (merchantHistory?.buckets ?? []).map((bucket) => {
        const row: Record<string, string | number> = {
          bucket_label: bucket.bucket_label,
          total: bucket.total
        };
        for (const merchant of merchantTrendSeries) {
          row[merchant] = bucket.merchants[merchant] ?? 0;
        }
        return row;
      }),
    [merchantHistory, merchantTrendSeries]
  );
  const mortgageChartRows = useMemo(() => {
    if (!mortgageProjection) return [];
    const maxMonths = Math.max(
      mortgageProjection.baseline.length,
      mortgageProjection.with_extra.length
    );
    return Array.from({ length: maxMonths }, (_, index) => {
      const base = mortgageProjection.baseline[index];
      const extra = mortgageProjection.with_extra[index];
      return {
        month: index + 1,
        baseline_balance: base?.balance ?? 0,
        extra_balance: extra?.balance ?? 0,
        baseline_interest: base?.cumulative_interest ?? 0,
        extra_interest: extra?.cumulative_interest ?? 0
      };
    });
  }, [mortgageProjection]);
  const monthlyPaymentRows = useMemo(() => mortgageActivity?.monthly ?? [], [mortgageActivity]);
  const observedMonthlyPayment = useMemo(() => {
    const rows = monthlyPaymentRows.filter((row) => row.payment_amount > 0);
    if (!rows.length) return 0;
    return rows.reduce((sum, row) => sum + row.payment_amount, 0) / rows.length;
  }, [monthlyPaymentRows]);
  const paidPrincipal = useMemo(() => {
    if (mortgageOriginalPrincipal <= 0) return 0;
    return Math.max(0, mortgageOriginalPrincipal - mortgagePrincipal);
  }, [mortgageOriginalPrincipal, mortgagePrincipal]);
  const principalProgressPct = useMemo(() => {
    if (mortgageOriginalPrincipal <= 0) return 0;
    return Math.min(100, (paidPrincipal / mortgageOriginalPrincipal) * 100);
  }, [mortgageOriginalPrincipal, paidPrincipal]);
  const mortgageRequiredFields = useMemo(() => {
    const missing: string[] = [];
    if (!mortgageAccountId) missing.push('mortgage account');
    if (mortgagePrincipal <= 0) missing.push('current balance');
    if (mortgageRate <= 0) missing.push('interest rate');
    if (mortgageYears <= 0) missing.push('years remaining');
    return missing;
  }, [mortgageAccountId, mortgagePrincipal, mortgageRate, mortgageYears]);
  const mortgageAccounts = useMemo(
    () => accounts.filter((account) => isLiabilityAccount(account)),
    [accounts]
  );
  const filteredBalanceAccounts = useMemo(
    () =>
      (balanceTrends?.accounts ?? []).filter(
        (account) => !(excludeHousing && account.is_liability && account.name.toLowerCase().includes('mortgage'))
      ),
    [balanceTrends, excludeHousing]
  );
  const filteredBalanceTrendRows = useMemo(() => {
    if (!balanceTrends) return [];
    if (!excludeHousing) return balanceTrends.points;
    const remainingLiabilityIds = new Set(
      filteredBalanceAccounts.filter((account) => account.is_liability).map((account) => account.account_id)
    );
    return balanceTrends.points.map((point) => {
      const liabilities = filteredBalanceAccounts
        .filter((account) => account.is_liability && remainingLiabilityIds.has(account.account_id))
        .reduce((sum, account) => {
          const match = account.points.find((entry) => entry.date === point.date);
          return sum + Math.abs(match?.balance ?? 0);
        }, 0);
      return {
        date: point.date,
        assets: point.assets,
        liabilities,
        net_worth: point.assets - liabilities
      };
    });
  }, [balanceTrends, excludeHousing, filteredBalanceAccounts]);
  const weeklyOutflowDisplay = useMemo(
    () =>
      excludeHousing
        ? weeklyCategoryData.reduce((sum, row) => sum + row.amount, 0)
        : (weekly?.totals.outflow ?? 0),
    [excludeHousing, weekly, weeklyCategoryData]
  );
  const monthlyOutflowDisplay = useMemo(
    () =>
      excludeHousing
        ? monthlyCategoryData.reduce((sum, row) => sum + row.amount, 0)
        : (monthly?.totals.outflow ?? 0),
    [excludeHousing, monthly, monthlyCategoryData]
  );
  const weeklyNetDisplay = useMemo(
    () => (excludeHousing ? (weekly?.totals.inflow ?? 0) - weeklyOutflowDisplay : (weekly?.totals.net ?? 0)),
    [excludeHousing, weekly, weeklyOutflowDisplay]
  );
  const monthlyNetDisplay = useMemo(
    () => (excludeHousing ? (monthly?.totals.inflow ?? 0) - monthlyOutflowDisplay : (monthly?.totals.net ?? 0)),
    [excludeHousing, monthly, monthlyOutflowDisplay]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const bucketRollup = useMemo(() => {
    const rollupFor = (items: { category: string; amount: number }[]) => {
      const totals = new Map<string, number>();
      for (const item of items) {
        const categoryId = categoryIdsByLabel.get(item.category);
        const bucket = categoryId ? categoryById.get(categoryId)?.spend_bucket ?? null : null;
        const key = spendBucketLabel(bucket);
        totals.set(key, (totals.get(key) ?? 0) + item.amount);
      }
      return [...totals.entries()]
        .map(([bucket, amount]) => ({ bucket, amount }))
        .sort((a, b) => b.amount - a.amount);
    };
    return {
      weekly: rollupFor(weeklyCategoryData),
      monthly: rollupFor(monthlyCategoryData),
      yearly: rollupFor(yearlyCategoryData)
    };
  }, [
    categoryById,
    categoryIdsByLabel,
    monthlyCategoryData,
    weeklyCategoryData,
    yearlyCategoryData
  ]);
  const activeCategoryData =
    overviewTab === 'weekly'
      ? weeklyCategoryData
      : overviewTab === 'monthly'
        ? monthlyCategoryData
        : yearlyCategoryData;
  const activeBucketData = bucketRollup[overviewTab];

  function openTransactionsForCategory(categoryLabel: string, rangeStart: string, rangeEnd: string) {
    const categoryId = categoryIdsByLabel.get(categoryLabel);
    navigate(
      buildTransactionsHref({
        start: rangeStart,
        end: rangeEnd,
        includePending,
        includeTransfers: false,
        categoryId: categoryId ?? null,
        categoryFamily:
          categoryId == null
            ? categoryLabel.includes(' > ')
              ? categoryLabel.split(' > ')[0]
              : categoryLabel
            : null
      })
    );
  }

  function openTransactionsForMerchant(merchant: string) {
    const merchantStart = shiftMonthsForWindow(
      end,
      merchantWindowMonths,
      merchantBucket === 'month'
    );
    navigate(
      buildTransactionsHref({
        start: merchantStart,
        end,
        includePending,
        includeTransfers,
        q: merchant
      })
    );
  }

  function openTransactionsForAccount(accountId: string) {
    navigate(
      buildTransactionsHref({
        start,
        end,
        includePending,
        includeTransfers: true,
        accountId
      })
    );
  }

  function renderWeeklyNavigator() {
    return (
      <div className="analytics-week-nav">
        <button
          type="button"
          className="secondary"
          onClick={() => setWeeklyOffset((value) => value + 1)}
          aria-label="Show previous week"
        >
          ←
        </button>
        <strong>{weeklyRangeLabel}</strong>
        <button
          type="button"
          className="secondary"
          onClick={() => setWeeklyOffset((value) => Math.max(0, value - 1))}
          disabled={weeklyOffset === 0}
          aria-label="Show next week"
        >
          →
        </button>
      </div>
    );
  }

  function renderMonthlyNavigator() {
    return (
      <div className="analytics-week-nav">
        <button
          type="button"
          className="secondary"
          onClick={() => setMonthlyOffset((value) => value - 1)}
          aria-label="Show previous month"
        >
          ←
        </button>
        <strong>{monthlyRangeLabel}</strong>
        <button
          type="button"
          className="secondary"
          onClick={() => setMonthlyOffset((value) => Math.min(0, value + 1))}
          disabled={monthlyOffset === 0}
          aria-label="Show next month"
        >
          →
        </button>
      </div>
    );
  }

  function renderYearlyNavigator() {
    return (
      <div className="analytics-week-nav">
        <button
          type="button"
          className="secondary"
          onClick={() => setYearlyOffset((value) => value - 1)}
          aria-label="Show previous year"
        >
          ←
        </button>
        <strong>{yearlyRangeLabel}</strong>
        <button
          type="button"
          className="secondary"
          onClick={() => setYearlyOffset((value) => Math.min(0, value + 1))}
          disabled={yearlyOffset === 0}
          aria-label="Show next year"
        >
          →
        </button>
      </div>
    );
  }

  return (
    <SectionLayout
      pageKey="analytics_insights"
      title="Insights"
      expandAllByDefault={true}
      sections={[
        {
          id: 'insights-overview',
          label: 'Overview',
          content: (
            <>
              <div className="grid two">
                <article className="card">
                  <h4>Report Scope</h4>
                  <div className="filters">
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
                        checked={excludeHousing}
                        onChange={(e) => setExcludeHousing(e.target.checked)}
                      />
                      Exclude housing and mortgage
                    </label>
                  </div>
                  <p className="category-editor-note">
                    Weekly, monthly, and yearly rollups with transfers excluded.
                    {excludeHousing ? ' Housing categories and mortgage-account scale are excluded from overview visuals.' : ''}
                  </p>
                </article>
                <article className="card">
                  <h4>Spend Pulse</h4>
                  <div className="grid two">
                    <div>
                      <strong>This week</strong>
                      <p>${weeklyOutflowDisplay.toFixed(0)}</p>
                      <small>Net {weeklyNetDisplay.toFixed(0)}</small>
                    </div>
                    <div>
                      <strong>This month</strong>
                      <p>${monthlyOutflowDisplay.toFixed(0)}</p>
                      <small>Net {monthlyNetDisplay.toFixed(0)}</small>
                    </div>
                    <div>
                      <strong>This year</strong>
                      <p>${yearlyOutflow.toFixed(0)}</p>
                      <small>{yearlyTrendRows.length} months loaded</small>
                    </div>
                    <div>
                      <strong>Top monthly category</strong>
                      <p>{monthlyCategoryData[0]?.category ?? 'None'}</p>
                      <small>${monthlyCategoryData[0]?.amount.toFixed(0) ?? '0'}</small>
                    </div>
                  </div>
                </article>
              </div>
              <div className="toolbar tabs">
                <button
                  type="button"
                  className={`tab-button ${overviewTab === 'weekly' ? 'active' : ''}`}
                  onClick={() => setOverviewTab('weekly')}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  className={`tab-button ${overviewTab === 'monthly' ? 'active' : ''}`}
                  onClick={() => setOverviewTab('monthly')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={`tab-button ${overviewTab === 'yearly' ? 'active' : ''}`}
                  onClick={() => setOverviewTab('yearly')}
                >
                  Yearly
                </button>
              </div>
              {overviewTab === 'weekly' && (
                <div className="grid two">
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Weekly Category Share</h4>
                      {renderWeeklyNavigator()}
                    </div>
                    <CategoryWaffleChart
                      items={weeklyCategoryData}
                      maxLegendItems={5}
                      caption="Each square represents about 1% of this week’s spending, excluding transfers."
                      getCategoryColor={getCategoryColor}
                      onLegendClick={(category) =>
                        openTransactionsForCategory(
                          category,
                          selectedWeeklyStart,
                          selectedWeeklyEnd
                        )
                      }
                    />
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Weekly Bucket Rollup</h4>
                      {renderWeeklyNavigator()}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={activeBucketData}>
                        <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="bucket" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                        <Tooltip {...tooltipStyle} />
                        <Bar dataKey="amount" fill="var(--series-2)" radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="amount" position="top" formatter={(value: number) => `$${value.toFixed(0)}`} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Daily Spend Trend</h4>
                      {renderWeeklyNavigator()}
                    </div>
                    <ExpandableChart label="Weekly Spend Trend" height={320} expandedHeight={520}>
                      {(height) => (
                        <ResponsiveContainer width="100%" height={height}>
                          <BarChart data={weekly?.daily_outflow ?? []}>
                            <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="label" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                            <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                            <Tooltip {...tooltipStyle} />
                            <Bar dataKey="outflow" fill="var(--series-2)" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ExpandableChart>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Top Categories</h4>
                      {renderWeeklyNavigator()}
                    </div>
                    <table className="table dense">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Spend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklyCategoryData.map((row) => (
                          <tr key={row.category}>
                            <td>{row.category}</td>
                            <td>${row.amount.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </article>
                </div>
              )}
              {overviewTab === 'monthly' && (
                <div className="grid two">
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Monthly Category Share</h4>
                      {renderMonthlyNavigator()}
                    </div>
                    <CategoryWaffleChart
                      items={monthlyCategoryData}
                      caption="Each square represents about 1% of monthly spending, excluding transfers."
                      getCategoryColor={getCategoryColor}
                      onLegendClick={(category) =>
                        openTransactionsForCategory(
                          category,
                          selectedMonthStart,
                          selectedMonthEnd
                        )
                      }
                    />
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Monthly Bucket Rollup</h4>
                      {renderMonthlyNavigator()}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={activeBucketData}>
                        <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="bucket" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                        <Tooltip {...tooltipStyle} />
                        <Bar dataKey="amount" fill="var(--series-3)" radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="amount" position="top" formatter={(value: number) => `$${value.toFixed(0)}`} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Monthly Category Breakdown</h4>
                      {renderMonthlyNavigator()}
                    </div>
                    <ExpandableChart label="Monthly Category Breakdown" height={320} expandedHeight={640}>
                      {(height) => (
                        <ResponsiveContainer width="100%" height={height}>
                          <BarChart
                            data={monthlyCategoryData}
                            layout="vertical"
                            margin={{ top: 8, right: 72, bottom: 8, left: 24 }}
                          >
                            <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                            <YAxis
                              type="category"
                              dataKey="category"
                              width={150}
                              stroke="var(--fg)"
                              tick={{ fill: 'var(--fg)', fontSize: 12 }}
                            />
                            <Tooltip {...tooltipStyle} />
                            <Bar
                              dataKey="amount"
                              radius={[8, 8, 8, 8]}
                              cursor="pointer"
                              onClick={(data) => {
                                if (data?.category) {
                                  openTransactionsForCategory(
                                    String(data.category),
                                    selectedMonthStart,
                                    selectedMonthEnd
                                  );
                                }
                              }}
                            >
                              <LabelList dataKey="amount" content={<SignedCurrencyLabel />} />
                              {monthlyCategoryData.map((entry, index) => (
                                <Cell
                                  key={`${entry.category}-${index}`}
                                  fill={categoryStyle.get(entry.category) || getCategoryColor(entry.category, index)}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ExpandableChart>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Daily Spend Trend</h4>
                      {renderMonthlyNavigator()}
                    </div>
                    <ExpandableChart label="Monthly Spend Trend" height={320} expandedHeight={520}>
                      {(height) => (
                        <ResponsiveContainer width="100%" height={height}>
                          <LineChart data={monthly?.daily_outflow ?? []}>
                            <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="label" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                            <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                            <Tooltip {...tooltipStyle} />
                            <Line
                              type="monotone"
                              dataKey="outflow"
                              stroke="var(--series-3)"
                              strokeWidth={3}
                              dot={false}
                              activeDot={{ r: 5 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </ExpandableChart>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Biggest Month-over-Month Moves</h4>
                      {renderMonthlyNavigator()}
                    </div>
                    <table className="table dense">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Current</th>
                          <th>Previous</th>
                          <th>Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyChangeData.map((row) => (
                          <tr key={row.category}>
                            <td>{row.category}</td>
                            <td>${row.current.toFixed(0)}</td>
                            <td>${row.previous.toFixed(0)}</td>
                            <td className={row.delta >= 0 ? 'negative' : 'positive'}>
                              {row.delta >= 0 ? '+' : '-'}${Math.abs(row.delta).toFixed(0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </article>
                </div>
              )}
              {overviewTab === 'yearly' && (
                <div className="grid two">
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Yearly Category Share</h4>
                      {renderYearlyNavigator()}
                    </div>
                    <CategoryWaffleChart
                      items={yearlyCategoryData}
                      caption="Each square represents about 1% of this year’s spending, excluding transfers."
                      getCategoryColor={getCategoryColor}
                      onLegendClick={(category) =>
                        openTransactionsForCategory(
                          category,
                          yearlyRangeStart,
                          yearlyRangeEnd
                        )
                      }
                    />
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Yearly Bucket Rollup</h4>
                      {renderYearlyNavigator()}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={activeBucketData}>
                        <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="bucket" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                        <Tooltip {...tooltipStyle} />
                        <Bar dataKey="amount" fill="var(--series-5)" radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="amount" position="top" formatter={(value: number) => `$${value.toFixed(0)}`} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Year-to-Date Trend</h4>
                      {renderYearlyNavigator()}
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={yearlyTrendRows}>
                        <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Line dataKey="outflow" stroke="var(--series-3)" strokeWidth={2.5} dot={false} />
                        <Line dataKey="inflow" stroke="var(--series-5)" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </article>
                  <article className="card">
                    <div className="analytics-card-head">
                      <h4>Top Yearly Categories</h4>
                      {renderYearlyNavigator()}
                    </div>
                    <table className="table dense">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Spend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeCategoryData.map((row) => (
                          <tr key={row.category}>
                            <td>{row.category}</td>
                            <td>${row.amount.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </article>
                </div>
              )}
            </>
          )
        },
        {
          id: 'insights-merchants',
          label: 'Merchants',
          content: (
            <>
              <article className="card">
                <h4>Merchant Scope</h4>
                <div className="filters">
                  <label>
                    Window
                    <select
                      value={merchantWindowMonths}
                      onChange={(e) => setMerchantWindowMonths(Number(e.target.value))}
                    >
                      <option value={3}>3 months</option>
                      <option value={6}>6 months</option>
                      <option value={12}>12 months</option>
                      <option value={24}>24 months</option>
                    </select>
                  </label>
                  <label>
                    Bucket
                    <select
                      value={merchantBucket}
                      onChange={(e) => setMerchantBucket(e.target.value as 'week' | 'month')}
                    >
                      <option value="month">Monthly</option>
                      <option value="week">Weekly</option>
                    </select>
                  </label>
                  <label>
                    Merchants
                    <select
                      value={merchantTopN}
                      onChange={(e) => setMerchantTopN(Number(e.target.value))}
                    >
                      <option value={5}>Top 5</option>
                      <option value={8}>Top 8</option>
                      <option value={12}>Top 12</option>
                    </select>
                  </label>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={includeTransfers}
                      onChange={(e) => setIncludeTransfers(e.target.checked)}
                    />
                    Include transfers
                  </label>
                </div>
                <p className="category-editor-note">
                  Grouped merchant spend from {merchantHistory?.start ?? '-'} to {merchantHistory?.end ?? '-'}.
                </p>
              </article>
              <div className="grid two">
                <article className="card">
                  <h4>Top Merchants</h4>
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(320, merchantLeaderboardRows.length * 42)}
                  >
                    <BarChart
                      data={merchantLeaderboardRows}
                      layout="vertical"
                      margin={{ top: 8, right: 72, bottom: 8, left: 12 }}
                    >
                      <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                      <YAxis
                        type="category"
                        dataKey="merchant"
                        width={190}
                        stroke="var(--fg)"
                        tick={{ fill: 'var(--fg)', fontSize: 12 }}
                      />
                      <Tooltip {...tooltipStyle} />
                      <Bar
                        dataKey="total"
                        radius={[8, 8, 8, 8]}
                        cursor="pointer"
                        onClick={(data) => {
                          if (data?.merchant) openTransactionsForMerchant(String(data.merchant));
                        }}
                      >
                        <LabelList dataKey="total" content={<SignedCurrencyLabel />} />
                        {merchantLeaderboardRows.map((row, index) => (
                          <Cell key={row.merchant} fill={merchantSeriesColor(index)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </article>
                <article className="card">
                  <h4>Merchant Trend</h4>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={merchantTrendRows}>
                      <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bucket_label" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                      <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                      <Tooltip {...tooltipStyle} />
                      {merchantTrendSeries.map((merchant, index) => (
                        <Line
                          key={merchant}
                          dataKey={merchant}
                          stroke={merchantSeriesColor(index)}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </article>
                <article className="card">
                  <h4>Top Merchant By Category Family</h4>
                  <table className="table dense">
                    <thead>
                      <tr>
                        <th>Family</th>
                        <th>Merchant</th>
                        <th>Merchant spend</th>
                        <th>Family spend</th>
                        <th>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(merchantHistory?.top_by_family ?? []).map((row) => (
                        <tr key={`${row.family}-${row.merchant}`}>
                          <td>{row.family}</td>
                          <td>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => openTransactionsForMerchant(row.merchant)}
                            >
                              {row.merchant}
                            </button>
                          </td>
                          <td>${row.total.toFixed(0)}</td>
                          <td>${row.family_total.toFixed(0)}</td>
                          <td>{row.share_of_family.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              </div>
            </>
          )
        },
        {
          id: 'insights-flow',
          label: 'Flow & Forecast',
          content: (
            <>
              <article className="card">
                <h4>Analysis Scope</h4>
                <div className="filters">
                  <label>
                    Start
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                  </label>
                  <label>
                    End
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </label>
                  <label>
                    Sankey mode
                    <select value={sankeyMode} onChange={(e) => setSankeyMode(e.target.value)}>
                      <option value="account_to_grouped_category">Accounts → Groups → Categories</option>
                      <option value="account_to_category">Accounts → Categories</option>
                      <option value="category_to_account">Categories → Accounts</option>
                    </select>
                  </label>
                  <label>
                    Categories per group
                    <select
                      value={sankeyMaxCategoriesPerGroup}
                      onChange={(e) => setSankeyMaxCategoriesPerGroup(Number(e.target.value))}
                    >
                      <option value={3}>Top 3</option>
                      <option value={4}>Top 4</option>
                      <option value={5}>Top 5</option>
                      <option value={6}>Top 6</option>
                      <option value={8}>Top 8</option>
                    </select>
                  </label>
                  <label>
                    Category filter
                    <select
                      value={sankeyCategoryId}
                      onChange={(e) => setSankeyCategoryId(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {sankeyCategoryOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="category-editor-note">
                  Bounded flow map for the selected window. Narrow it with the category filter instead of zooming.
                </p>
              </article>
              <article className="card">
                <h4>Flow Map</h4>
                <SankeyChart nodes={sankeyRaw.nodes} links={sankeyRaw.links} height={320} />
              </article>
              <div className="grid two">
                <article className="card">
                  <h4>Net Worth Trend</h4>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={filteredBalanceTrendRows}>
                      <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                      <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                      <Tooltip {...tooltipStyle} />
                      <Line dataKey="assets" stroke="var(--series-5)" dot={false} strokeWidth={2.5} />
                      <Line dataKey="liabilities" stroke="var(--danger)" dot={false} strokeWidth={2.5} />
                      <Line dataKey="net_worth" stroke="var(--series-1)" dot={false} strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </article>
                <article className="card">
                  <h4>Projection Knobs</h4>
                  <div className="filters">
                    <label>
                      Utility inflation
                      <input
                        type="number"
                        value={utilityInflation}
                        onChange={(e) => setUtilityInflation(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      General inflation
                      <input
                        type="number"
                        value={generalInflation}
                        onChange={(e) => setGeneralInflation(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Savings APR
                      <input
                        type="number"
                        value={savingsApr}
                        onChange={(e) => setSavingsApr(Number(e.target.value))}
                      />
                    </label>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={projection?.months ?? []}>
                      <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                      <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                      <Tooltip {...tooltipStyle} />
                      <Line dataKey="projected_total_spend" stroke="var(--series-2)" dot={false} strokeWidth={2.5} />
                      <Line dataKey="projected_utilities" stroke="var(--series-1)" dot={false} strokeWidth={2.5} />
                      <Line dataKey="projected_savings" stroke="var(--series-5)" dot={false} strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </article>
              </div>
            </>
          )
        },
        {
          id: 'insights-mortgage',
          label: 'Mortgage',
          content: (
            <>
              <article className="card">
                <h4>Mortgage Inputs</h4>
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
                      {mortgageAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.type})
                        </option>
                      ))}
                    </select>
                  </label>
                  {!mortgageAccountId ? (
                    <p className="category-editor-note">
                      Select a mortgage account to unlock payoff modeling and payment history.
                    </p>
                  ) : (
                    <>
                      <label className="inline">
                        <input
                          type="checkbox"
                          checked={autoSyncMortgageFromAccount}
                          onChange={(e) => setAutoSyncMortgageFromAccount(e.target.checked)}
                        />
                        Sync principal from account balance
                      </label>
                      <label>
                        Principal balance
                        <input type="number" value={mortgagePrincipal} onChange={(e) => setMortgagePrincipal(Number(e.target.value))} />
                      </label>
                      <label>
                        Original principal
                        <input
                          type="number"
                          value={mortgageOriginalPrincipal}
                          onChange={(e) => setMortgageOriginalPrincipal(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Interest rate
                        <input type="number" step="0.01" value={mortgageRate} onChange={(e) => setMortgageRate(Number(e.target.value))} />
                      </label>
                      <label>
                        Years remaining
                        <input type="number" value={mortgageYears} onChange={(e) => setMortgageYears(Number(e.target.value))} />
                      </label>
                      <label>
                        Monthly payment
                        <input type="number" value={mortgagePayment} onChange={(e) => setMortgagePayment(Number(e.target.value))} />
                      </label>
                      <label>
                        Extra payment
                        <input type="number" value={mortgageExtra} onChange={(e) => setMortgageExtra(Number(e.target.value))} />
                      </label>
                    </>
                  )}
                </div>
                {mortgageAccountId && (
                  <>
                    <p className="category-editor-note">
                      Required: {mortgageRequiredFields.length ? mortgageRequiredFields.join(', ') : 'ready to run'}
                    </p>
                    {observedMonthlyPayment > 0 && mortgagePayment <= 0 && (
                      <p className="category-editor-note">
                        Observed payment: ${observedMonthlyPayment.toFixed(2)}
                      </p>
                    )}
                  </>
                )}
              </article>
              {mortgageProjection && (
                <div className="grid two">
                  <article className="card">
                    <h4>Payoff Path</h4>
                    <p className="category-editor-note">
                      Principal paid: ${paidPrincipal.toFixed(0)} ({principalProgressPct.toFixed(1)}%)
                    </p>
                    <p className="category-editor-note">
                      Interest saved with extra payment: ${mortgageProjection.summary.interest_saved.toFixed(0)}
                    </p>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={mortgageChartRows}>
                        <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Line dataKey="baseline_balance" stroke="var(--danger)" dot={false} strokeWidth={2.5} />
                        <Line dataKey="extra_balance" stroke="var(--series-5)" dot={false} strokeWidth={2.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </article>
                  <article className="card">
                    <h4>Observed Mortgage Activity</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={monthlyPaymentRows}>
                        <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" />
                        <XAxis dataKey="month" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                        <Tooltip {...tooltipStyle} />
                        <Bar
                          dataKey="payment_amount"
                          fill="var(--series-5)"
                          cursor="pointer"
                          onClick={() => mortgageAccountId && openTransactionsForAccount(mortgageAccountId)}
                        />
                        <Bar
                          dataKey="charge_amount"
                          fill="var(--danger)"
                          cursor="pointer"
                          onClick={() => mortgageAccountId && openTransactionsForAccount(mortgageAccountId)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </article>
                </div>
              )}
              {!mortgageProjection && (
                <p className="category-editor-note">
                  Mortgage projection appears after the required fields are filled in.
                </p>
              )}
            </>
          )
        }
      ]}
    />
  );
}
