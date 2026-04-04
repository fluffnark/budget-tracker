import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionsPage } from './TransactionsPage';

describe('TransactionsPage rule feedback', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('/api/categories')) {
          return new Response(
            JSON.stringify([
              {
                id: 10,
                parent_id: null,
                name: 'Transportation',
                system_kind: 'expense',
                color: null,
                icon: null
              }
            ])
          );
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
                amount: -42.5,
                currency: 'USD',
                description_raw: 'GAS STATION',
                description_norm: 'GAS STATION',
                is_pending: false,
                category_id: 10,
                category_name: 'Transportation',
                merchant_id: null,
                merchant_name: null,
                transfer_id: null,
                notes: null,
                manual_category_override: false
              }
            ])
          );
        }

        if (url.includes('/api/rules/preview') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              match_count: 2,
              sample_transaction_ids: ['txn-1', 'txn-2']
            })
          );
        }

        if (url.includes('/api/rules') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 1,
              priority: 100,
              match_type: 'contains',
              pattern: 'GAS STATION',
              category_id: 10,
              merchant_override_id: null,
              is_active: true,
              match_count: 2,
              sample_transaction_ids: ['txn-1', 'txn-2']
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

  it('shows rule applied count after creating a rule from transaction', async () => {
    render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTitle(/Expand Transactions/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle(/Expand Transactions/i));
    await waitFor(() => {
      expect(screen.getByText('GAS STATION')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Applied to 2 transactions/i)
      ).toBeInTheDocument();
    });
  });
});
