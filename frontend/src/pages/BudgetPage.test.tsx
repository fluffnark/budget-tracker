import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetPage } from './BudgetPage';

const monthPayload = {
  month_start: '2026-03-01',
  income_target: 5000,
  starting_cash: 300,
  planned_savings: 400,
  suggested_income_target: 4900,
  suggested_planned_savings: 350,
  leftover_strategy: 'unassigned',
  income_available: 5300,
  planned_spending: 1800,
  actual_spending: 620,
  remaining_to_budget: 3100,
  essential_planned: 1200,
  discretionary_planned: 600,
  rows: [
    {
      category_id: 1,
      category_name: 'Groceries',
      category_path: 'Food > Groceries',
      parent_category_name: 'Food',
      planned_amount: 500,
      actual_amount: 210,
      remaining_amount: 290,
      last_month_actual: 480,
      avg_3_month_actual: 460,
      is_fixed: false,
      is_essential: true,
      rollover_mode: 'surplus_only'
    },
    {
      category_id: 2,
      category_name: 'Streaming',
      category_path: 'Entertainment > Streaming',
      parent_category_name: 'Entertainment',
      planned_amount: 45,
      actual_amount: 45,
      remaining_amount: 0,
      last_month_actual: 45,
      avg_3_month_actual: 45,
      is_fixed: true,
      is_essential: false,
      rollover_mode: 'none'
    }
  ],
  family_summaries: [
    {
      family: 'Food',
      planned_amount: 500,
      actual_amount: 210,
      remaining_amount: 290,
      essential_planned: 500,
      discretionary_planned: 0
    },
    {
      family: 'Entertainment',
      planned_amount: 45,
      actual_amount: 45,
      remaining_amount: 0,
      essential_planned: 0,
      discretionary_planned: 45
    }
  ]
};

const periodPayload = {
  period: 'monthly',
  start: '2026-03-01',
  end: '2026-03-31',
  total_spend: 620,
  families: [
    {
      family: 'Food',
      amount: 210,
      subcategories: [{ category: 'Groceries', path: 'Food > Groceries', amount: 210 }]
    }
  ],
  trend: [
    {
      label: 'Jan',
      start: '2026-01-01',
      end: '2026-01-31',
      total: 550,
      families: { Food: 200, Entertainment: 45 }
    }
  ]
};

const recurringPayload = {
  as_of: '2026-03-01',
  estimated_monthly_total: 160,
  estimated_monthly_cancelable: 45,
  cancel_candidates: [
    {
      label: 'Spotify',
      category_name: 'Streaming',
      family_name: 'Entertainment',
      cadence: 'monthly',
      occurrences: 6,
      average_amount: 15,
      estimated_monthly_cost: 15,
      last_amount: 15,
      last_posted_at: '2026-02-18',
      next_expected_at: '2026-03-18',
      is_cancel_candidate: true
    }
  ],
  essential_candidates: [
    {
      label: 'PNM Electric',
      category_name: 'Utilities > Electric',
      family_name: 'Utilities',
      cadence: 'monthly',
      occurrences: 6,
      average_amount: 145,
      estimated_monthly_cost: 145,
      last_amount: 149,
      last_posted_at: '2026-02-20',
      next_expected_at: '2026-03-20',
      is_cancel_candidate: false
    }
  ]
};

describe('BudgetPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/budget/month') && init?.method === 'PUT') {
        return new Response(JSON.stringify(monthPayload));
      }
      if (url.includes('/api/budget/month')) {
        return new Response(JSON.stringify(monthPayload));
      }
      if (url.includes('/api/budget/period')) {
        return new Response(JSON.stringify(periodPayload));
      }
      if (url.includes('/api/budget/recurring')) {
        return new Response(JSON.stringify(recurringPayload));
      }
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders budget summaries and category rows', async () => {
    render(<BudgetPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: 'Budget Planner' })
      ).toBeInTheDocument();
    });
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Streaming').length).toBeGreaterThan(0);
    expect(screen.getByText('$5300.00')).toBeInTheDocument();
  });

  it('saves the edited budget month', async () => {
    render(<BudgetPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0);
    });

    const plannedInputs = screen.getAllByLabelText('Planned');
    fireEvent.change(plannedInputs[0], { target: { value: '550' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    await waitFor(() => {
      expect(screen.getByText('Budget saved.')).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/api/budget/month') && init?.method === 'PUT'
      )
    ).toBe(true);
  });
});
