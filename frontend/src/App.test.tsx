import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from './App';

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/reports/monthly')) {
    return new Response(
      JSON.stringify({
        totals: { inflow: 0, outflow: 0, net: 0 },
        category_breakdown: [],
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
    localStorage.setItem('bt_logged_in', '1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders login route', () => {
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(screen.getByText('Local Budget Tracker')).toBeInTheDocument();
  });

  it('renders dashboard route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(
      screen.getAllByRole('heading', { level: 2, name: 'Dashboard' }).length
    ).toBeGreaterThan(0);
  });

  it('renders transactions route', () => {
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Categorization Studio' })
    ).toBeInTheDocument();
  });
});
