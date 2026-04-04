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
    },
    {
      id: 'txn-2',
      account_id: 'acct-2',
      account_name: 'Credit Card',
      account_type: 'credit',
      posted_at: '2026-02-03T00:00:00Z',
      amount: -48.75,
      currency: 'USD',
      description_raw: 'UTILITY PAYMENT',
      description_norm: 'UTILITY PAYMENT',
      is_pending: false,
      category_id: 5,
      category_name: 'Food',
      merchant_id: null,
      merchant_name: 'Utility Co',
      transfer_id: null,
      notes: 'monthly utility',
      manual_category_override: false
    }
  ];
}

describe('CategorizePage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true
    });
    fetchMock = vi.fn(
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
        if (url.includes('/api/export/llm')) {
          return new Response(
            JSON.stringify({
              payload: {
                transactions: baseTransactions().map((txn) => ({
                  id: txn.id,
                  date: txn.posted_at.slice(0, 10),
                  amount: txn.amount,
                  currency: txn.currency,
                  description_norm: txn.description_norm,
                  merchant_canonical: txn.merchant_name,
                  account_type: txn.account_type,
                  category_id: txn.category_id,
                  category_path: txn.category_name ?? undefined,
                  is_pending: txn.is_pending,
                  is_transfer: false
                })),
                categories: [
                  {
                    id: 5,
                    full_path: 'Food',
                    system_kind: 'expense',
                    parent_id: null
                  }
                ]
              },
              prompt_template: ''
            })
          );
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
      screen.getByRole('button', { name: /Transactions \(2\)/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId('categorize-layout')).toBeInTheDocument();
  });

  it('filters studio rows with the transaction search field', async () => {
    render(
      <MemoryRouter>
        <CategorizePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
      expect(screen.getByText('UTILITY PAYMENT')).toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByPlaceholderText(
        'Keyword, merchant, category, or similar text'
      ),
      {
        target: { value: 'cofee' }
      }
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
      expect(screen.queryByText('UTILITY PAYMENT')).not.toBeInTheDocument();
    });
  });

  it('requests grouped sankey data for the studio chart', async () => {
    render(
      <MemoryRouter>
        <CategorizePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('COFFEE SHOP')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('mode=account_to_grouped_category')
        )
      ).toBe(true);
    });
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
        if (url.includes('/api/export/llm')) {
          return new Response(
            JSON.stringify({
              payload: {
                transactions: baseTransactions().map((txn) => ({
                  id: txn.id,
                  date: txn.posted_at.slice(0, 10),
                  amount: txn.amount,
                  currency: txn.currency,
                  description_norm: txn.description_norm,
                  merchant_canonical: txn.merchant_name,
                  account_type: txn.account_type,
                  category_id: txn.category_id,
                  category_path: txn.category_name ?? undefined,
                  is_pending: txn.is_pending,
                  is_transfer: false
                })),
                categories: [
                  {
                    id: 5,
                    full_path: 'Food',
                    system_kind: 'expense',
                    parent_id: null
                  }
                ]
              },
              prompt_template: ''
            })
          );
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

  it('copies different LLM prompt instructions for precision and coverage modes', async () => {
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

    const writeText = vi.mocked(navigator.clipboard.writeText);

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy compact LLM payload' })
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0][0]).toContain(
      'Skip uncertain transactions instead of guessing.'
    );

    fireEvent.change(screen.getByLabelText('Prompt mode'), {
      target: { value: 'high_coverage' }
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy compact LLM payload' })
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    expect(writeText.mock.calls[1][0]).toContain(
      'High coverage mode: aim to categorize as many `review_transactions` as possible'
    );
    expect(writeText.mock.calls[1][0]).toContain(
      'Do not use uncategorized as a fallback.'
    );
  });
});
