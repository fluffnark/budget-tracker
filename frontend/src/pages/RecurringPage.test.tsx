import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecurringPage } from './RecurringPage';

describe('RecurringPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/budget/recurring')) {
          return new Response(
            JSON.stringify({
              as_of: '2026-04-12',
              estimated_monthly_total: -149.98,
              estimated_monthly_cancelable: -9.99,
              cancel_candidates: [
                {
                  label: 'Video Stream',
                  category_name: 'Entertainment',
                  family_name: 'Subscriptions',
                  cadence: 'monthly',
                  occurrences: 4,
                  average_amount: -9.99,
                  estimated_monthly_cost: -9.99,
                  last_amount: -9.99,
                  last_posted_at: '2026-03-15',
                  next_expected_at: '2026-04-15',
                  is_cancel_candidate: true,
                  review_reason: 'Optional subscription'
                }
              ],
              essential_candidates: [
                {
                  label: 'Power Utility',
                  category_name: 'Utilities',
                  family_name: 'Home',
                  cadence: 'monthly',
                  occurrences: 6,
                  average_amount: -140,
                  estimated_monthly_cost: -140,
                  last_amount: -138.74,
                  last_posted_at: '2026-03-03',
                  next_expected_at: '2026-04-03',
                  is_cancel_candidate: false,
                  review_reason: null
                }
              ],
              review_candidates: [
                {
                  label: 'Cloud Storage',
                  category_name: 'Software',
                  family_name: 'Technology',
                  cadence: 'monthly',
                  occurrences: 2,
                  average_amount: -4.99,
                  estimated_monthly_cost: -4.99,
                  last_amount: -4.99,
                  last_posted_at: '2026-03-21',
                  next_expected_at: null,
                  is_cancel_candidate: false,
                  review_reason: 'Not enough history to confirm a stable recurring pattern'
                }
              ]
            })
          );
        }
        return new Response(JSON.stringify({ ok: true }));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a recurring calendar with scheduled and unscheduled items', async () => {
    render(
      <MemoryRouter>
        <RecurringPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
      expect(screen.getByText('April 2026')).toBeInTheDocument();
    });

    expect(screen.getByText('2 scheduled this month')).toBeInTheDocument();
    expect(screen.getByText('1 need more history')).toBeInTheDocument();
    expect(screen.getAllByText('Power Utility').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Video Stream').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cloud Storage').length).toBeGreaterThan(0);
    expect(screen.getByText('Unscheduled recurring items')).toBeInTheDocument();
  });
});
