import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionsPage } from './TransactionsPage';

describe('Transactions section navigation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/categories')) {
          return new Response(JSON.stringify([]));
        }

        if (url.includes('/api/transactions')) {
          return new Response(
            JSON.stringify([
              {
                id: 'txn-1',
                account_id: 'acct-1',
                account_name: 'Checking',
                account_type: 'checking',
                posted_at: '2026-02-01T00:00:00Z',
                amount: -10.0,
                currency: 'USD',
                description_raw: 'SHOP',
                description_norm: 'SHOP',
                is_pending: false,
                category_id: null,
                category_name: null,
                merchant_id: null,
                merchant_name: null,
                transfer_id: null,
                notes: null,
                manual_category_override: false
              }
            ])
          );
        }

        return new Response(JSON.stringify({ ok: true }));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates location hash when jump nav is clicked', async () => {
    render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('SHOP')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Transactions \(1\)/i })
    );
    expect(window.location.hash).toBe('#tx-table');
  });
});
