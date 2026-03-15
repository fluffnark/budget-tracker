import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { apiFetch } from '../api';
import { ExpandableChart } from '../components/ExpandableChart';

type WeeklyData = {
  totals: { inflow: number; outflow: number; net: number };
  top_categories: { category: string; amount: number }[];
  daily_outflow: { date: string; label: string; outflow: number }[];
  largest_transactions: {
    description: string;
    amount: number;
    account: string;
  }[];
  utilities: { category: string; amount: number }[];
};

type MonthlyData = {
  totals: { inflow: number; outflow: number; net: number };
  category_breakdown: { category: string; amount: number }[];
  daily_outflow: { date: string; label: string; outflow: number }[];
  mom_deltas: {
    category: string;
    current: number;
    previous: number;
    delta: number;
  }[];
  utilities: { category: string; amount: number }[];
};

type YearlyData = {
  year: number;
  monthly_totals: {
    month: number;
    inflow: number;
    outflow: number;
    net: number;
  }[];
  category_trends: { category: string; months: number[] }[];
};

export function ReportsPage() {
  const [tab, setTab] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [yearly, setYearly] = useState<YearlyData | null>(null);
  const [includePending, setIncludePending] = useState(true);

  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();

  useEffect(() => {
    const weeklyStart = new Date(today);
    weeklyStart.setDate(today.getDate() - 6);
    const start = weeklyStart.toISOString().slice(0, 10);
    const end = today.toISOString().slice(0, 10);

    apiFetch<WeeklyData>(
      `/api/reports/weekly?start=${start}&end=${end}&include_pending=${includePending ? 1 : 0}&include_transfers=0`
    )
      .then(setWeekly)
      .catch(() => setWeekly(null));

    apiFetch<MonthlyData>(
      `/api/reports/monthly?year=${year}&month=${month}&include_pending=${includePending ? 1 : 0}&include_transfers=0`
    )
      .then(setMonthly)
      .catch(() => setMonthly(null));

    apiFetch<YearlyData>(
      `/api/reports/yearly?year=${year}&include_pending=${includePending ? 1 : 0}&include_transfers=0`
    )
      .then(setYearly)
      .catch(() => setYearly(null));
  }, [includePending]);

  const categoryBarData = useMemo(
    () =>
      [...(monthly?.category_breakdown ?? [])]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [monthly]
  );
  const pieColor = (category: string, index: number) => {
    const palette = [
      'var(--series-1)',
      'var(--series-2)',
      'var(--series-3)',
      'var(--series-4)',
      'var(--series-5)'
    ];
    let hash = 0;
    for (let i = 0; i < category.length; i += 1) {
      hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
    }
    const palettePick = palette[hash % palette.length];
    if (index < palette.length * 2) return palettePick;
    const hue = hash % 360;
    return `hsl(${hue} 62% 52%)`;
  };

  return (
    <section>
      <h2>Reports</h2>
      <div className="toolbar tabs">
        <button
          type="button"
          className={`tab-button ${tab === 'weekly' ? 'active' : ''}`}
          onClick={() => setTab('weekly')}
        >
          Weekly
        </button>
        <button
          type="button"
          className={`tab-button ${tab === 'monthly' ? 'active' : ''}`}
          onClick={() => setTab('monthly')}
        >
          Monthly
        </button>
        <button
          type="button"
          className={`tab-button ${tab === 'yearly' ? 'active' : ''}`}
          onClick={() => setTab('yearly')}
        >
          Yearly
        </button>
        <label className="inline">
          <input
            type="checkbox"
            checked={includePending}
            onChange={(e) => setIncludePending(e.target.checked)}
          />
          Include pending
        </label>
      </div>

      {tab === 'weekly' && weekly && (
        <div className="grid two">
          <article className="card">
            <h3>Totals</h3>
            <p>Inflow: {weekly.totals.inflow.toFixed(2)}</p>
            <p>Outflow: {weekly.totals.outflow.toFixed(2)}</p>
            <p>Net: {weekly.totals.net.toFixed(2)}</p>
          </article>
          <article className="card">
            <h3>Top Categories</h3>
            <ul>
              {weekly.top_categories.map((item) => (
                <li key={item.category}>
                  {item.category}: {item.amount.toFixed(2)}
                </li>
              ))}
            </ul>
          </article>
          <article className="card">
            <h3>Daily Spend</h3>
            <ExpandableChart label="Weekly Spend Over Time" height={260} expandedHeight={420}>
              {(height) => (
                <ResponsiveContainer width="100%" height={height}>
                  <BarChart data={weekly.daily_outflow} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                    <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--fg)'
                      }}
                      labelStyle={{ color: 'var(--fg)' }}
                      itemStyle={{ color: 'var(--fg)' }}
                    />
                    <Bar dataKey="outflow" fill="var(--series-2)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ExpandableChart>
          </article>
        </div>
      )}

      {tab === 'monthly' && monthly && (
        <div className="grid two">
          <article className="card">
            <h3>Category Breakdown</h3>
            <ExpandableChart label="Monthly Category Breakdown" height={320} expandedHeight={720}>
              {(height) => (
                <ResponsiveContainer width="100%" height={height}>
                  <BarChart
                    data={categoryBarData}
                    layout="vertical"
                    margin={{ top: 8, right: 72, bottom: 8, left: 24 }}
                  >
                    <CartesianGrid
                      stroke="var(--text-subtle)"
                      strokeDasharray="3 3"
                      horizontal={false}
                    />
                    <XAxis type="number" stroke="var(--fg)" tick={{ fill: 'var(--fg)' }} />
                    <YAxis
                      type="category"
                      dataKey="category"
                      width={140}
                      stroke="var(--fg)"
                      tick={{ fill: 'var(--fg)', fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--fg)'
                      }}
                      labelStyle={{ color: 'var(--fg)' }}
                      itemStyle={{ color: 'var(--fg)' }}
                    />
                    <Bar
                      dataKey="amount"
                      radius={[8, 8, 8, 8]}
                    >
                      <LabelList
                        dataKey="amount"
                        position="right"
                        formatter={(value: number) => `$${value.toFixed(0)}`}
                      />
                      {categoryBarData.map((entry, idx) => (
                        <Cell
                          key={`${entry.category}-${idx}`}
                          fill={pieColor(entry.category, idx)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ExpandableChart>
          </article>
          <article className="card">
            <h3>Daily Spend Trend</h3>
            <ExpandableChart label="Monthly Spend Over Time" height={320} expandedHeight={520}>
              {(height) => (
                <ResponsiveContainer width="100%" height={height}>
                  <LineChart data={monthly.daily_outflow} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--text-subtle)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="var(--fg)"
                      tick={{ fill: 'var(--fg)', fontSize: 12 }}
                      interval={Math.max(0, Math.floor(monthly.daily_outflow.length / 8) - 1)}
                    />
                    <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--fg)'
                      }}
                      labelStyle={{ color: 'var(--fg)' }}
                      itemStyle={{ color: 'var(--fg)' }}
                    />
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
            <h3>MoM Delta</h3>
            <ul>
              {monthly.mom_deltas.slice(0, 8).map((row) => (
                <li key={row.category}>
                  {row.category}: {row.delta.toFixed(2)}
                </li>
              ))}
            </ul>
            <h4>Utilities</h4>
            <ul>
              {monthly.utilities.map((u) => (
                <li key={u.category}>
                  {u.category}: {u.amount.toFixed(2)}
                </li>
              ))}
            </ul>
          </article>
        </div>
      )}

      {tab === 'yearly' && yearly && (
        <article className="card">
          <h3>Yearly Trend</h3>
          <ExpandableChart label="Yearly Trend" height={300} expandedHeight={680}>
            {(height) => (
              <ResponsiveContainer width="100%" height={height}>
                <LineChart data={yearly.monthly_totals}>
                  <CartesianGrid
                    stroke="var(--text-subtle)"
                    strokeDasharray="3 3"
                  />
                  <XAxis dataKey="month" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip />
                  <Line dataKey="outflow" stroke="var(--series-3)" />
                  <Line dataKey="inflow" stroke="var(--series-2)" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ExpandableChart>
        </article>
      )}
    </section>
  );
}
