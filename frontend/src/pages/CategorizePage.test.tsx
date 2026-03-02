import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CategorizePage } from './CategorizePage';

function baseTransactions() {
  return [
    {
      id: 'txn-1',
      account_id: 'acct-1',
      account_name: 'Checking',
      account_type: 'checking',
      posted_at: '2026-02-01T00:00:00Z',
      amount: -12.5,
      currency: 'USD',
      description_raw: 'COFFEE SHOP',
      description_norm: 'COFFEE SHOP',
      is_pending: false,
      category_id: null,
      category_name: null,
      merchant_id: null,
      merchant_name: null,
      transfer_id: null,
      notes: null,
      manual_category_override: false
    }
  ];
}

describe('CategorizePage', () => {
  beforeEach(() => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/settings')) {
          return new Response(
            JSON.stringify({
              sync_daily_hour: 6,
              sync_daily_minute: 0,
              simplefin_mock: true,
              scrub_default: true,
              auto_categorization: true
            })
          );
        }
        if (url.includes('/api/categories')) {
          return new Response(
            JSON.stringify([
              {
                id: 5,
                parent_id: null,
                name: 'Food',
                system_kind: 'expense',
                color: null,
                icon: null
              }
            ])
          );
        }
        if (url.includes('/api/transactions')) {
          return new Response(JSON.stringify(baseTransactions()));
        }
        if (url.includes('/api/analytics/sankey')) {
          return new Response(JSON.stringify({ nodes: [], links: [] }));
        }
        if (
          url.includes('/api/categorization/suggest') &&
          init?.method === 'POST'
        ) {
          return new Response(
            JSON.stringify({
              suggestions: [
                {
                  transaction_id: 'txn-1',
                  suggested_category_id: 5,
                  confidence: 0.91,
                  reason: 'merchant_history',
                  category_path: 'Food'
                }
              ]
            })
          );
        }
        if (
          url.includes('/api/categorization/apply') &&
          init?.method === 'POST'
        ) {
          return new Response(
            JSON.stringify({
              applied_count: 1,
              skipped_count: 0,
              skipped_reasons: {}
            })
          );
        }
        return new Response(JSON.stringify({ ok: true }));
      }
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders studio table and section layout', async () => {
    render(
      <MemoryRouter>
        <CategorizePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /Transactions \(1\)/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId('categorize-layout')).toBeInTheDocument();
  });

  it('auto-categorize button shows loading state and opens review modal', async () => {
    render(
      <MemoryRouter>
        <CategorizePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
    });

    const button = screen.getByRole('button', { name: 'Auto-categorize' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Auto-categorizing...' })
      ).toBeDisabled();
    });
    await waitFor(() => {
      expect(
        screen.getByText('Review Auto-categorize Suggestions')
      ).toBeInTheDocument();
    });
  });

  it('review modal supports apply above threshold and shows success toast', async () => {
    render(
      <MemoryRouter>
        <CategorizePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Auto-categorize' }));

    await waitFor(() => {
      expect(
        screen.getByText('Review Auto-categorize Suggestions')
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply all above threshold' })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Applied 1 categories, skipped 0/i)
      ).toBeInTheDocument();
    });
  });

  it('renders suggest error and re-enables button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/settings')) {
          return new Response(
            JSON.stringify({
              sync_daily_hour: 6,
              sync_daily_minute: 0,
              simplefin_mock: true,
              scrub_default: true,
              auto_categorization: true
            })
          );
        }
        if (url.includes('/api/categories')) {
          return new Response(
            JSON.stringify([
              {
                id: 5,
                parent_id: null,
                name: 'Food',
                system_kind: 'expense',
                color: null,
                icon: null
              }
            ])
          );
        }
        if (url.includes('/api/transactions')) {
          return new Response(JSON.stringify(baseTransactions()));
        }
        if (url.includes('/api/analytics/sankey')) {
          return new Response(JSON.stringify({ nodes: [], links: [] }));
        }
        if (
          url.includes('/api/categorization/suggest') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify({ detail: 'Suggest failed' }), {
            status: 500
          });
        }
        return new Response(JSON.stringify({ ok: true }));
      })
    );

    render(
      <MemoryRouter>
        <CategorizePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Auto-categorize' }));

    await waitFor(() => {
      expect(screen.getByText(/Suggest failed/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Auto-categorize' })
      ).toBeEnabled();
    });
  });
});
