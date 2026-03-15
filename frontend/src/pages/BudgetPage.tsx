import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts';

import { apiFetch } from '../api';
import { SectionLayout } from '../components/SectionLayout';
import type {
  BudgetRecurringSnapshot,
  BudgetCategoryPlanRow,
  BudgetMonthSnapshot,
  BudgetPeriodSnapshot
} from '../types';

function monthInputValue(raw: string): string {
  return raw.slice(0, 7);
}

function asMonthDate(monthValue: string): string {
  return `${monthValue}-01`;
}

function fmtCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(0)}`;
}

function fmtMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function BudgetPage() {
  const [monthValue, setMonthValue] = useState(new Date().toISOString().slice(0, 7));
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [periodSnapshot, setPeriodSnapshot] = useState<BudgetPeriodSnapshot | null>(null);
  const [recurringSnapshot, setRecurringSnapshot] = useState<BudgetRecurringSnapshot | null>(null);
  const [rows, setRows] = useState<BudgetCategoryPlanRow[]>([]);
  const [incomeTarget, setIncomeTarget] = useState(0);
  const [startingCash, setStartingCash] = useState(0);
  const [plannedSavings, setPlannedSavings] = useState(0);
  const [leftoverStrategy, setLeftoverStrategy] =
    useState<BudgetMonthSnapshot['leftover_strategy']>('unassigned');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [suggestedIncomeTarget, setSuggestedIncomeTarget] = useState(0);
  const [suggestedPlannedSavings, setSuggestedPlannedSavings] = useState(0);

  useEffect(() => {
    apiFetch<BudgetMonthSnapshot>(`/api/budget/month?month=${asMonthDate(monthValue)}`)
      .then((data) => {
        setRows(data.rows);
        setIncomeTarget(data.income_target);
        setStartingCash(data.starting_cash);
        setPlannedSavings(data.planned_savings);
        setSuggestedIncomeTarget(data.suggested_income_target);
        setSuggestedPlannedSavings(data.suggested_planned_savings);
        setLeftoverStrategy(data.leftover_strategy);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load budget'));
  }, [monthValue]);

  useEffect(() => {
    apiFetch<BudgetPeriodSnapshot>(
      `/api/budget/period?period=${period}&anchor=${asMonthDate(monthValue)}`
    )
      .then(setPeriodSnapshot)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load spend cadence')
      );
  }, [monthValue, period]);

  useEffect(() => {
    apiFetch<BudgetRecurringSnapshot>(`/api/budget/recurring?anchor=${asMonthDate(monthValue)}`)
      .then(setRecurringSnapshot)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load recurring payments')
      );
  }, [monthValue]);

  const plannedSpending = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.planned_amount || 0), 0),
    [rows]
  );
  const incomeAvailable = useMemo(
    () => Number(incomeTarget || 0) + Number(startingCash || 0),
    [incomeTarget, startingCash]
  );
  const remainingToBudget = useMemo(
    () => incomeAvailable - plannedSpending - Number(plannedSavings || 0),
    [incomeAvailable, plannedSpending, plannedSavings]
  );
  const essentialPlanned = useMemo(
    () =>
      rows
        .filter((row) => row.is_essential)
        .reduce((sum, row) => sum + Number(row.planned_amount || 0), 0),
    [rows]
  );
  const discretionaryPlanned = useMemo(
    () =>
      rows
        .filter((row) => !row.is_essential)
        .reduce((sum, row) => sum + Number(row.planned_amount || 0), 0),
    [rows]
  );

  const groupedRows = useMemo(() => {
    const groups = new Map<string, BudgetCategoryPlanRow[]>();
    for (const row of rows) {
      const key = row.parent_category_name ?? row.category_name;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .map(([family, items]) => ({
        family,
        items: items.sort((a, b) => a.category_name.localeCompare(b.category_name)),
        planned: items.reduce((sum, row) => sum + row.planned_amount, 0),
        actual: items.reduce((sum, row) => sum + row.actual_amount, 0)
      }))
      .sort((a, b) => b.planned - a.planned);
  }, [rows]);

  const familyBars = useMemo(
    () =>
      groupedRows.map((group) => ({
        family: group.family,
        planned: Number(group.planned.toFixed(2)),
        actual: Number(group.actual.toFixed(2)),
        remaining: Number((group.planned - group.actual).toFixed(2))
      })),
    [groupedRows]
  );

  const balanceBar = useMemo(
    () => [
      {
        name: 'This month',
        spending: Number(plannedSpending.toFixed(2)),
        savings: Number(Number(plannedSavings || 0).toFixed(2)),
        remaining: Math.max(0, Number(remainingToBudget.toFixed(2))),
        overshoot: Math.max(0, Number((-remainingToBudget).toFixed(2)))
      }
    ],
    [plannedSpending, plannedSavings, remainingToBudget]
  );

  const splitBar = useMemo(
    () => [
      {
        name: 'Plan mix',
        essentials: Number(essentialPlanned.toFixed(2)),
        discretionary: Number(discretionaryPlanned.toFixed(2)),
        savings: Number(Number(plannedSavings || 0).toFixed(2))
      }
    ],
    [essentialPlanned, discretionaryPlanned, plannedSavings]
  );

  const trendFamilies = useMemo(() => {
    const keys = new Set<string>();
    for (const point of periodSnapshot?.trend ?? []) {
      for (const key of Object.keys(point.families)) keys.add(key);
    }
    return [...keys];
  }, [periodSnapshot]);

  function updateRow(categoryId: number, patch: Partial<BudgetCategoryPlanRow>) {
    setRows((current) =>
      current.map((row) =>
        row.category_id === categoryId ? { ...row, ...patch } : row
      )
    );
  }

  function applyFill(source: 'last_month_actual' | 'avg_3_month_actual' | 'actual_amount') {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        planned_amount: Number(row[source].toFixed(2))
      }))
    );
    if (source === 'avg_3_month_actual') {
      if (incomeTarget === 0) setIncomeTarget(suggestedIncomeTarget);
      if (plannedSavings === 0) setPlannedSavings(suggestedPlannedSavings);
    }
  }

  async function saveBudget() {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const data = await apiFetch<BudgetMonthSnapshot>('/api/budget/month', {
        method: 'PUT',
        body: JSON.stringify({
          month_start: asMonthDate(monthValue),
          income_target: Number(incomeTarget || 0),
          starting_cash: Number(startingCash || 0),
          planned_savings: Number(plannedSavings || 0),
          leftover_strategy: leftoverStrategy,
          rows: rows.map((row) => ({
            category_id: row.category_id,
            planned_amount: Number(row.planned_amount || 0),
            is_fixed: row.is_fixed,
            is_essential: row.is_essential,
            rollover_mode: row.rollover_mode
          }))
        })
      });
      setRows(data.rows);
      setSuggestedIncomeTarget(data.suggested_income_target);
      setSuggestedPlannedSavings(data.suggested_planned_savings);
      setMessage('Budget saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionLayout
      pageKey="budget_v1"
      title="Budget Planner"
      expandAllByDefault
      sections={[
        {
          id: 'budget-controls',
          label: 'Month Setup',
          content: (
            <div className="filters budget-controls">
              <label>
                Budget month
                <input
                  type="month"
                  value={monthValue}
                  onChange={(e) => setMonthValue(e.target.value)}
                />
              </label>
              <label>
                Income target
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={incomeTarget}
                  onChange={(e) => setIncomeTarget(Number(e.target.value))}
                />
                {suggestedIncomeTarget > 0 && (
                  <small>3-month avg take-home: {fmtMoney(suggestedIncomeTarget)}</small>
                )}
              </label>
              <label>
                Starting cash
                <input
                  type="number"
                  step="0.01"
                  value={startingCash}
                  onChange={(e) => setStartingCash(Number(e.target.value))}
                />
              </label>
              <label>
                Planned savings
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={plannedSavings}
                  onChange={(e) => setPlannedSavings(Number(e.target.value))}
                />
                {suggestedPlannedSavings > 0 && (
                  <small>3-month avg leftover: {fmtMoney(suggestedPlannedSavings)}</small>
                )}
              </label>
              <label>
                Leftover handling
                <select
                  value={leftoverStrategy}
                  onChange={(e) =>
                    setLeftoverStrategy(
                      e.target.value as BudgetMonthSnapshot['leftover_strategy']
                    )
                  }
                >
                  <option value="unassigned">Leave unassigned</option>
                  <option value="send_to_savings">Send to savings</option>
                  <option value="send_to_debt">Send to debt payoff</option>
                </select>
              </label>
              <div className="budget-action-cluster">
                <button type="button" className="secondary" onClick={() => applyFill('last_month_actual')}>
                  Fill last month
                </button>
                <button type="button" className="secondary" onClick={() => applyFill('avg_3_month_actual')}>
                  Fill 3-mo avg
                </button>
                <button type="button" className="secondary" onClick={() => applyFill('actual_amount')}>
                  Fill current actual
                </button>
                <button type="button" disabled={saving} onClick={saveBudget}>
                  {saving ? 'Saving...' : 'Save budget'}
                </button>
              </div>
              {message && <p className="budget-message ok">{message}</p>}
              {error && <p className="budget-message error">{error}</p>}
            </div>
          )
        },
        {
          id: 'budget-periods',
          label: 'Weekly / Monthly / Yearly Spend',
          content: (
            <div className="budget-period-layout">
              <div className="toolbar tabs">
                <button
                  type="button"
                  className={`tab-button ${period === 'weekly' ? 'active' : ''}`}
                  onClick={() => setPeriod('weekly')}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  className={`tab-button ${period === 'monthly' ? 'active' : ''}`}
                  onClick={() => setPeriod('monthly')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={`tab-button ${period === 'yearly' ? 'active' : ''}`}
                  onClick={() => setPeriod('yearly')}
                >
                  Yearly
                </button>
              </div>
              <div className="budget-period-grid">
                <article className="card budget-chart-card">
                  <h3>
                    {periodSnapshot
                      ? `${periodSnapshot.start} to ${periodSnapshot.end}`
                      : 'Current period'}
                  </h3>
                  <p className="big">
                    {fmtMoney(periodSnapshot?.total_spend ?? 0)}
                  </p>
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(260, (periodSnapshot?.families.length ?? 1) * 48)}
                  >
                    <BarChart
                      data={periodSnapshot?.families ?? []}
                      layout="vertical"
                      margin={{ top: 10, right: 20, bottom: 10, left: 28 }}
                    >
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="family"
                        width={96}
                        stroke="var(--fg)"
                        tick={{ fill: 'var(--fg)', fontSize: 12 }}
                      />
                      <Bar dataKey="amount" fill="var(--series-2)" radius={[8, 8, 8, 8]}>
                        <LabelList dataKey="amount" position="right" formatter={fmtCurrency} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </article>
                <article className="card budget-chart-card">
                  <h3>Recent trend</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={periodSnapshot?.trend ?? []} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                      <YAxis stroke="var(--fg)" tick={{ fill: 'var(--fg)', fontSize: 12 }} />
                      {trendFamilies.map((family, index) => (
                        <Bar
                          key={family}
                          dataKey={`families.${family}`}
                          stackId="a"
                          fill={`var(--series-${(index % 5) + 1})`}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="budget-inline-legend">
                    {trendFamilies.map((family, index) => (
                      <span key={family}>
                        <i className={`swatch series-${(index % 5) + 1}`} />
                        {family}
                      </span>
                    ))}
                  </div>
                </article>
              </div>
              <article className="card">
                <h3>Family and subcategory totals</h3>
                <div className="budget-period-list">
                  {(periodSnapshot?.families ?? []).map((family) => (
                    <details key={family.family} open>
                      <summary>
                        <strong>{family.family}</strong>
                        <span>{fmtMoney(family.amount)}</span>
                      </summary>
                      <ul>
                        {family.subcategories.map((subcategory) => (
                          <li key={subcategory.path}>
                            <span>{subcategory.category}</span>
                            <strong>{fmtMoney(subcategory.amount)}</strong>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </article>
            </div>
          )
        },
        {
          id: 'budget-recurring',
          label: 'Subscriptions & Regular Payments',
          content: (
            <div className="budget-plan-layout">
              <div className="budget-summary-grid">
                <article className="card">
                  <h3>Recurring monthly total</h3>
                  <p className="big">{fmtMoney(recurringSnapshot?.estimated_monthly_total ?? 0)}</p>
                </article>
                <article className="card">
                  <h3>Cancel review total</h3>
                  <p className="big budget-negative">
                    {fmtMoney(recurringSnapshot?.estimated_monthly_cancelable ?? 0)}
                  </p>
                </article>
              </div>
              <div className="budget-period-grid">
                <article className="card">
                  <h3>Review for cancellation</h3>
                  <p className="budget-caption">
                    Repeating discretionary charges or memberships worth checking this month.
                  </p>
                  <div className="budget-period-list">
                    {(recurringSnapshot?.cancel_candidates ?? []).map((item) => (
                      <details key={`${item.label}-${item.next_expected_at}`} open>
                        <summary>
                          <div>
                            <strong>{item.label}</strong>
                            <small>
                              {item.family_name} • {item.cadence} • next {item.next_expected_at}
                            </small>
                          </div>
                          <span>{fmtMoney(item.estimated_monthly_cost)}</span>
                        </summary>
                        <ul>
                          <li>
                            <span>Average charge</span>
                            <strong>{fmtMoney(item.average_amount)}</strong>
                          </li>
                          <li>
                            <span>Last charge</span>
                            <strong>{fmtMoney(item.last_amount)}</strong>
                          </li>
                          <li>
                            <span>Occurrences seen</span>
                            <strong>{item.occurrences}</strong>
                          </li>
                          <li>
                            <span>Category</span>
                            <strong>{item.category_name}</strong>
                          </li>
                        </ul>
                      </details>
                    ))}
                    {!(recurringSnapshot?.cancel_candidates.length) && (
                      <p className="category-editor-note">No obvious cancellation candidates detected yet.</p>
                    )}
                  </div>
                </article>
                <article className="card">
                  <h3>Likely fixed bills</h3>
                  <p className="budget-caption">
                    Stable recurring essentials that should usually stay in the monthly plan.
                  </p>
                  <div className="budget-period-list">
                    {(recurringSnapshot?.essential_candidates ?? []).map((item) => (
                      <details key={`${item.label}-${item.last_posted_at}`} open>
                        <summary>
                          <div>
                            <strong>{item.label}</strong>
                            <small>
                              {item.family_name} • {item.cadence} • last {item.last_posted_at}
                            </small>
                          </div>
                          <span>{fmtMoney(item.estimated_monthly_cost)}</span>
                        </summary>
                        <ul>
                          <li>
                            <span>Average charge</span>
                            <strong>{fmtMoney(item.average_amount)}</strong>
                          </li>
                          <li>
                            <span>Next expected</span>
                            <strong>{item.next_expected_at}</strong>
                          </li>
                          <li>
                            <span>Occurrences seen</span>
                            <strong>{item.occurrences}</strong>
                          </li>
                          <li>
                            <span>Category</span>
                            <strong>{item.category_name}</strong>
                          </li>
                        </ul>
                      </details>
                    ))}
                    {!(recurringSnapshot?.essential_candidates.length) && (
                      <p className="category-editor-note">No stable fixed bills detected yet.</p>
                    )}
                  </div>
                </article>
              </div>
            </div>
          )
        },
        {
          id: 'budget-summary',
          label: 'Budget Summary',
          content: (
            <div className="budget-summary-grid">
              <article className="card">
                <h3>Income available</h3>
                <p className="big">{fmtMoney(incomeAvailable)}</p>
              </article>
              <article className="card">
                <h3>Planned spending</h3>
                <p className="big">{fmtMoney(plannedSpending)}</p>
              </article>
              <article className="card">
                <h3>Planned savings</h3>
                <p className="big">{fmtMoney(Number(plannedSavings || 0))}</p>
              </article>
              <article className="card">
                <h3>Remaining to budget</h3>
                <p
                  className={`big ${
                    remainingToBudget < 0
                      ? 'budget-negative'
                      : remainingToBudget > 0
                        ? 'budget-positive'
                        : ''
                  }`}
                >
                  {fmtMoney(remainingToBudget)}
                </p>
              </article>
              <article className="card budget-chart-card">
                <h3>Budget balance</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={balanceBar}
                    layout="vertical"
                    margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" hide />
                    <Bar dataKey="spending" stackId="a" fill="var(--series-2)">
                      <LabelList dataKey="spending" position="insideTopLeft" formatter={fmtCurrency} />
                    </Bar>
                    <Bar dataKey="savings" stackId="a" fill="var(--series-5)">
                      <LabelList dataKey="savings" position="insideTop" formatter={fmtCurrency} />
                    </Bar>
                    <Bar dataKey="remaining" stackId="a" fill="var(--success)">
                      <LabelList dataKey="remaining" position="insideTopRight" formatter={fmtCurrency} />
                    </Bar>
                    <Bar dataKey="overshoot" stackId="a" fill="var(--danger)">
                      <LabelList dataKey="overshoot" position="right" formatter={fmtCurrency} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="budget-caption">
                  Income available minus planned spending and savings. Red indicates the plan is over budget.
                </p>
              </article>
              <article className="card budget-chart-card">
                <h3>Essentials vs discretionary</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={splitBar}
                    layout="vertical"
                    margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" hide />
                    <Bar dataKey="essentials" stackId="a" fill="var(--primary)">
                      <LabelList dataKey="essentials" position="insideTopLeft" formatter={fmtCurrency} />
                    </Bar>
                    <Bar dataKey="discretionary" stackId="a" fill="var(--series-3)">
                      <LabelList dataKey="discretionary" position="insideTop" formatter={fmtCurrency} />
                    </Bar>
                    <Bar dataKey="savings" stackId="a" fill="var(--series-5)">
                      <LabelList dataKey="savings" position="insideTopRight" formatter={fmtCurrency} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="budget-inline-legend">
                  <span><i className="swatch essentials" />Essentials</span>
                  <span><i className="swatch discretionary" />Discretionary</span>
                  <span><i className="swatch savings" />Savings</span>
                </div>
              </article>
            </div>
          )
        },
        {
          id: 'budget-categories',
          label: 'Planned vs Actual',
          content: (
            <div className="budget-plan-layout">
              <article className="card budget-chart-card">
                <h3>By family</h3>
                <ResponsiveContainer width="100%" height={Math.max(260, familyBars.length * 48)}>
                  <BarChart
                    data={familyBars}
                    layout="vertical"
                    margin={{ top: 10, right: 20, bottom: 10, left: 28 }}
                    barGap={8}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="family"
                      width={92}
                      stroke="var(--fg)"
                      tick={{ fill: 'var(--fg)', fontSize: 12 }}
                    />
                    <Bar dataKey="planned" fill="var(--primary)" radius={[8, 8, 8, 8]}>
                      <LabelList dataKey="planned" position="right" formatter={fmtCurrency} />
                    </Bar>
                    <Bar dataKey="actual" fill="var(--series-4)" radius={[8, 8, 8, 8]}>
                      <LabelList dataKey="actual" position="right" formatter={fmtCurrency} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="budget-caption">Direct labels are used here so the chart still reads cleanly on phones.</p>
              </article>
              <div className="budget-family-list">
                {groupedRows.map((group) => (
                  <details key={group.family} className="card budget-family-card" open>
                    <summary>
                      <div>
                        <strong>{group.family}</strong>
                        <small>
                          Planned {fmtMoney(group.planned)} • Actual {fmtMoney(group.actual)}
                        </small>
                      </div>
                    </summary>
                    <div className="budget-category-rows">
                      {group.items.map((row) => (
                        <div key={row.category_id} className="budget-category-row">
                          <div className="budget-category-head">
                            <div>
                              <strong>{row.category_name}</strong>
                              <small>
                                Actual {fmtMoney(row.actual_amount)} • Last {fmtMoney(row.last_month_actual)} • Avg {fmtMoney(row.avg_3_month_actual)}
                              </small>
                            </div>
                            <span
                              className={`badge ${
                                row.is_essential ? 'budget-badge-essential' : 'budget-badge-discretionary'
                              }`}
                            >
                              {row.is_essential ? 'Essential' : 'Discretionary'}
                            </span>
                          </div>
                          <div className="budget-row-controls">
                            <label>
                              Planned
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={row.planned_amount}
                                onChange={(e) =>
                                  updateRow(row.category_id, {
                                    planned_amount: Number(e.target.value)
                                  })
                                }
                              />
                            </label>
                            <label>
                              Type
                              <select
                                value={row.is_fixed ? 'fixed' : 'flexible'}
                                onChange={(e) =>
                                  updateRow(row.category_id, {
                                    is_fixed: e.target.value === 'fixed'
                                  })
                                }
                              >
                                <option value="fixed">Fixed</option>
                                <option value="flexible">Flexible</option>
                              </select>
                            </label>
                            <label>
                              Priority
                              <select
                                value={row.is_essential ? 'essential' : 'discretionary'}
                                onChange={(e) =>
                                  updateRow(row.category_id, {
                                    is_essential: e.target.value === 'essential'
                                  })
                                }
                              >
                                <option value="essential">Essential</option>
                                <option value="discretionary">Discretionary</option>
                              </select>
                            </label>
                            <label>
                              Rollover
                              <select
                                value={row.rollover_mode}
                                onChange={(e) =>
                                  updateRow(row.category_id, {
                                    rollover_mode: e.target.value as BudgetCategoryPlanRow['rollover_mode']
                                  })
                                }
                              >
                                <option value="none">No rollover</option>
                                <option value="surplus_only">Roll unused forward</option>
                                <option value="next_month_cover">Cover next month</option>
                              </select>
                            </label>
                          </div>
                          <div className="budget-mini-meter">
                            <div
                              className="budget-mini-meter-plan"
                              style={{ width: '100%' }}
                            />
                            <div
                              className="budget-mini-meter-actual"
                              style={{
                                width: `${Math.min(
                                  100,
                                  row.planned_amount > 0
                                    ? (row.actual_amount / row.planned_amount) * 100
                                    : 0
                                )}%`
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )
        }
      ]}
    />
  );
}
