import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { apiFetch } from '../api';
import { SectionLayout } from '../components/SectionLayout';
import type { BudgetRecurringSnapshot, RecurringPaymentCandidate } from '../types';
import { buildTransactionsHref } from '../utils/transactionsLink';

type RecurringCandidateBucket = 'cancel' | 'essential' | 'review';
type CalendarEntry = {
  candidate: RecurringPaymentCandidate;
  bucket: RecurringCandidateBucket;
};

function asMonthDate(monthValue: string): string {
  return `${monthValue}-01`;
}

function monthBounds(monthValue: string): { start: string; end: string } {
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {
    start: `${monthValue}-01`,
    end
  };
}

function fmtMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function monthLabel(monthValue: string): string {
  return new Date(`${monthValue}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function dayLabel(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function bucketLabel(bucket: RecurringCandidateBucket): string {
  if (bucket === 'cancel') return 'Cancel review';
  if (bucket === 'essential') return 'Fixed bill';
  return 'Emerging';
}

function monthDayCount(monthValue: string): number {
  const [yearRaw, monthRaw] = monthValue.split('-');
  return new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 0)).getUTCDate();
}

function monthStartWeekday(monthValue: string): number {
  return new Date(`${monthValue}-01T00:00:00Z`).getUTCDay();
}

function isWithinMonth(dateValue: string | null, monthValue: string): dateValue is string {
  return Boolean(dateValue && dateValue.slice(0, 7) === monthValue);
}

function recurringHref(label: string, monthValue: string): string {
  const { start, end } = monthBounds(monthValue);
  return buildTransactionsHref({
    start,
    end,
    includePending: true,
    includeTransfers: false,
    q: `"${label}"`
  });
}

function dueSoonCount(items: RecurringPaymentCandidate[], asOf: string): number {
  const anchor = new Date(`${asOf}T00:00:00Z`).getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    if (!item.next_expected_at) return false;
    const next = new Date(`${item.next_expected_at}T00:00:00Z`).getTime();
    return next >= anchor && next <= anchor + weekMs;
  }).length;
}

function CandidateList({
  items,
  monthValue,
  emptyMessage
}: {
  items: RecurringPaymentCandidate[];
  monthValue: string;
  emptyMessage: string;
}) {
  if (!items.length) {
    return <p className="category-editor-note">{emptyMessage}</p>;
  }

  return (
    <div className="budget-period-list recurring-card-list">
      {items.map((item) => (
        <details key={`${item.label}-${item.last_posted_at}-${item.next_expected_at ?? 'na'}`} open>
          <summary>
            <div>
              <strong>{item.label}</strong>
              <small>
                {item.family_name} • {item.review_reason ?? item.cadence}
              </small>
            </div>
            <span>{fmtMoney(item.estimated_monthly_cost)}</span>
          </summary>
          <ul>
            <li>
              <span>Category</span>
              <strong>{item.category_name}</strong>
            </li>
            <li>
              <span>Average charge</span>
              <strong>{fmtMoney(item.average_amount)}</strong>
            </li>
            <li>
              <span>Last charge</span>
              <strong>{fmtMoney(item.last_amount)}</strong>
            </li>
            <li>
              <span>Last posted</span>
              <strong>{item.last_posted_at}</strong>
            </li>
            <li>
              <span>Next expected</span>
              <strong>{item.next_expected_at ?? 'Need more history'}</strong>
            </li>
            <li>
              <span>Occurrences seen</span>
              <strong>{item.occurrences}</strong>
            </li>
          </ul>
          <div className="recurring-actions">
            <Link className="secondary button-link" to={recurringHref(item.label, monthValue)}>
              Open matching transactions
            </Link>
            <Link className="secondary button-link" to="/budget#budget-recurring">
              Open in budget workflow
            </Link>
          </div>
        </details>
      ))}
    </div>
  );
}

function CalendarSection({
  entries,
  monthValue
}: {
  entries: CalendarEntry[];
  monthValue: string;
}) {
  const daysInMonth = monthDayCount(monthValue);
  const leadingBlanks = monthStartWeekday(monthValue);
  const scheduled = entries
    .filter((entry) => isWithinMonth(entry.candidate.next_expected_at, monthValue))
    .sort((left, right) => {
      const dateDiff = left.candidate.next_expected_at!.localeCompare(
        right.candidate.next_expected_at!
      );
      if (dateDiff !== 0) return dateDiff;
      return Math.abs(right.candidate.estimated_monthly_cost) - Math.abs(left.candidate.estimated_monthly_cost);
    });
  const unscheduled = entries.filter(
    (entry) => !isWithinMonth(entry.candidate.next_expected_at, monthValue)
  );
  const byDate = new Map<string, CalendarEntry[]>();

  scheduled.forEach((entry) => {
    const dayKey = entry.candidate.next_expected_at!;
    byDate.set(dayKey, [...(byDate.get(dayKey) ?? []), entry]);
  });

  const cells = Array.from({ length: leadingBlanks + daysInMonth }, (_, index) => {
    if (index < leadingBlanks) {
      return <div key={`blank-${index}`} className="recurring-calendar-day recurring-calendar-day--blank" />;
    }

    const dayNumber = index - leadingBlanks + 1;
    const dayKey = `${monthValue}-${String(dayNumber).padStart(2, '0')}`;
    const dayEntries = byDate.get(dayKey) ?? [];
    return (
      <article key={dayKey} className="recurring-calendar-day">
        <header>
          <span>{dayNumber}</span>
          {dayEntries.length > 0 && <strong>{dayEntries.length}</strong>}
        </header>
        {dayEntries.length === 0 ? (
          <p className="recurring-calendar-empty">No expected charges</p>
        ) : (
          <ul className="recurring-calendar-list">
            {dayEntries.slice(0, 3).map((entry) => (
              <li key={`${entry.bucket}-${entry.candidate.label}-${dayKey}`}>
                <Link to={recurringHref(entry.candidate.label, monthValue)}>
                  <strong>{entry.candidate.label}</strong>
                  <span>
                    {fmtMoney(entry.candidate.estimated_monthly_cost)} • {bucketLabel(entry.bucket)}
                  </span>
                </Link>
              </li>
            ))}
            {dayEntries.length > 3 && (
              <li className="recurring-calendar-more">+{dayEntries.length - 3} more</li>
            )}
          </ul>
        )}
      </article>
    );
  });

  return (
    <div className="recurring-calendar-wrap">
      <div className="recurring-calendar-header">
        <div>
          <h3>{monthLabel(monthValue)}</h3>
          <p className="budget-caption">
            Expected bill dates are forecast from recent recurring history and grouped directly in
            this workflow.
          </p>
        </div>
        <div className="recurring-calendar-kpis">
          <span>{scheduled.length} scheduled this month</span>
          <span>{unscheduled.length} need more history</span>
        </div>
      </div>
      <div className="recurring-calendar-weekdays" aria-hidden="true">
        <span>Sun</span>
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
      </div>
      <div className="recurring-calendar-grid">{cells}</div>
      <div className="recurring-calendar-footer">
        <div>
          <h4>Unscheduled recurring items</h4>
          {unscheduled.length === 0 ? (
            <p className="category-editor-note">Everything has an expected date for this month.</p>
          ) : (
            <ul className="recurring-upcoming-list">
              {unscheduled.map((entry) => (
                <li key={`${entry.bucket}-${entry.candidate.label}-${entry.candidate.last_posted_at}`}>
                  <Link to={recurringHref(entry.candidate.label, monthValue)}>
                    <strong>{entry.candidate.label}</strong>
                  </Link>
                  <span>
                    {entry.candidate.next_expected_at
                      ? `Next expected ${dayLabel(entry.candidate.next_expected_at)}`
                      : 'Need more history for forecast'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function RecurringPage() {
  const [monthValue, setMonthValue] = useState(new Date().toISOString().slice(0, 7));
  const [snapshot, setSnapshot] = useState<BudgetRecurringSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    apiFetch<BudgetRecurringSnapshot>(`/api/budget/recurring?anchor=${asMonthDate(monthValue)}`)
      .then(setSnapshot)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load recurring payments')
      );
  }, [monthValue]);

  const activeRecurringCount = useMemo(
    () =>
      (snapshot?.cancel_candidates.length ?? 0) +
      (snapshot?.essential_candidates.length ?? 0) +
      (snapshot?.review_candidates.length ?? 0),
    [snapshot]
  );

  const dueSoon = useMemo(
    () =>
      dueSoonCount(
        [
          ...(snapshot?.cancel_candidates ?? []),
          ...(snapshot?.essential_candidates ?? []),
          ...(snapshot?.review_candidates ?? [])
        ],
        snapshot?.as_of ?? asMonthDate(monthValue)
      ),
    [monthValue, snapshot]
  );

  const calendarEntries = useMemo(
    () => [
      ...(snapshot?.cancel_candidates ?? []).map((candidate) => ({
        candidate,
        bucket: 'cancel' as const
      })),
      ...(snapshot?.essential_candidates ?? []).map((candidate) => ({
        candidate,
        bucket: 'essential' as const
      })),
      ...(snapshot?.review_candidates ?? []).map((candidate) => ({
        candidate,
        bucket: 'review' as const
      }))
    ],
    [snapshot]
  );

  return (
    <SectionLayout
      pageKey="recurring_v1"
      title="Recurring"
      expandAllByDefault
      intro={
        <div className="filters budget-controls recurring-toolbar">
          <label>
            Anchor month
            <input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
            />
          </label>
          <div className="recurring-toolbar-note">
            <strong>Dedicated recurring review</strong>
            <span>
              This turns recurring charges into a first-class workflow instead of a budget-only
              subsection.
            </span>
          </div>
          {error && <p className="budget-message error">{error}</p>}
        </div>
      }
      sections={[
        {
          id: 'recurring-overview',
          label: 'Overview',
          content: (
            <div className="budget-summary-grid">
              <article className="card">
                <h3>Recurring monthly total</h3>
                <p className="big">{fmtMoney(snapshot?.estimated_monthly_total ?? 0)}</p>
              </article>
              <article className="card">
                <h3>Cancel review total</h3>
                <p className="big budget-negative">
                  {fmtMoney(snapshot?.estimated_monthly_cancelable ?? 0)}
                </p>
              </article>
              <article className="card">
                <h3>Recurring items tracked</h3>
                <p className="big">{activeRecurringCount}</p>
              </article>
              <article className="card">
                <h3>Due in 7 days</h3>
                <p className="big">{dueSoon}</p>
              </article>
            </div>
          )
        },
        {
          id: 'recurring-calendar',
          label: 'Calendar',
          content: <CalendarSection entries={calendarEntries} monthValue={monthValue} />
        },
        {
          id: 'recurring-cancel',
          label: 'Cancel Review',
          content: (
            <>
              <p className="budget-caption">
                Repeating discretionary charges or memberships worth checking this month.
              </p>
              <CandidateList
                items={snapshot?.cancel_candidates ?? []}
                monthValue={monthValue}
                emptyMessage="No obvious cancellation candidates detected yet."
              />
            </>
          )
        },
        {
          id: 'recurring-fixed',
          label: 'Fixed Bills',
          content: (
            <>
              <p className="budget-caption">
                Stable recurring essentials that should usually stay in the monthly plan.
              </p>
              <CandidateList
                items={snapshot?.essential_candidates ?? []}
                monthValue={monthValue}
                emptyMessage="No stable fixed bills detected yet."
              />
            </>
          )
        },
        {
          id: 'recurring-emerging',
          label: 'Emerging Patterns',
          content: (
            <>
              <p className="budget-caption">
                Likely subscriptions or bills that have started showing up but do not have enough
                history yet.
              </p>
              <CandidateList
                items={snapshot?.review_candidates ?? []}
                monthValue={monthValue}
                emptyMessage="No emerging recurring payments need review."
              />
            </>
          )
        }
      ]}
    />
  );
}
