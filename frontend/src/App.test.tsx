import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from './App';

let authStatusOverride: Record<string, unknown> | null = null;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/auth/status')) {
    return new Response(
      JSON.stringify(
        authStatusOverride ?? {
          is_setup: true,
          is_authenticated: true,
          owner_email: 'owner@example.com',
          simplefin_connected: false,
          simplefin_status: null
        }
      )
    );
  }
  if (url.includes('/api/reports/monthly')) {
    return new Response(
      JSON.stringify({
        totals: { inflow: 0, outflow: 0, net: 0 },
        category_breakdown: [],
        daily_outflow: [],
        mom_deltas: [],
        utilities: []
      })
    );
  }
  if (url.includes('/api/reports/yearly')) {
    return new Response(
      JSON.stringify({ year: 2026, monthly_totals: [], category_trends: [] })
    );
  }
  if (url.includes('/api/reports/weekly')) {
    return new Response(
      JSON.stringify({
        totals: { inflow: 0, outflow: 0, net: 0 },
        top_categories: [],
        daily_outflow: [],
        largest_transactions: [],
        utilities: []
      })
    );
  }
  if (url.includes('/api/analytics/sankey')) {
    return new Response(JSON.stringify({ nodes: [], links: [] }));
  }
  if (url.includes('/api/analytics/projections')) {
    return new Response(
      JSON.stringify({
        baseline_utilities_monthly: 0,
        baseline_total_monthly: 0,
        months: []
      })
    );
  }
  if (url.includes('/api/budget/month')) {
    return new Response(
      JSON.stringify({
        month_start: '2026-03-01',
        income_target: 0,
        starting_cash: 0,
        planned_savings: 0,
        suggested_income_target: 0,
        suggested_planned_savings: 0,
        leftover_strategy: 'unassigned',
        income_available: 0,
        planned_spending: 0,
        actual_spending: 0,
        remaining_to_budget: 0,
        essential_planned: 0,
        discretionary_planned: 0,
        rows: [],
        family_summaries: []
      })
    );
  }
  if (url.includes('/api/budget/period')) {
    return new Response(
      JSON.stringify({
        period: 'monthly',
        start: '2026-03-01',
        end: '2026-03-31',
        total_spend: 0,
        families: [],
        trend: []
      })
    );
  }
  if (url.includes('/api/budget/recurring')) {
    return new Response(
      JSON.stringify({
        as_of: '2026-03-01',
        estimated_monthly_total: 0,
        estimated_monthly_cancelable: 0,
        cancel_candidates: [],
        essential_candidates: []
      })
    );
  }
  if (url.includes('/api/settings')) {
    return new Response(
      JSON.stringify({
        sync_daily_hour: 6,
        sync_daily_minute: 0,
        simplefin_mock: true,
        scrub_default: true,
        auto_categorization: false
      })
    );
  }
  return new Response(JSON.stringify([]));
});

describe('app routes smoke', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    authStatusOverride = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockClear();
    authStatusOverride = null;
  });

  it('renders login route', async () => {
    authStatusOverride = {
      is_setup: false,
      is_authenticated: false,
      owner_email: null,
      simplefin_connected: false,
      simplefin_status: null
    };
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(await screen.findByText('Set Up Your Budget Tracker')).toBeInTheDocument();
  });

  it('renders dashboard route', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(
        screen.getAllByRole('heading', { level: 2, name: 'Home' }).length
      ).toBeGreaterThan(0);
    });
  });

  it('renders transactions route', async () => {
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Categorization Studio' })
    ).toBeInTheDocument();
  });

  it('renders budget route', async () => {
    render(
      <MemoryRouter initialEntries={['/budget']}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Budget Planner' })
    ).toBeInTheDocument();
  });
});
