import { describe, expect, it } from 'vitest';

import { applyTransactionFilters } from './transactionFilters';

const txns = [
  {
    id: '1',
    account_id: 'a1',
    account_name: 'Checking',
    account_type: 'checking',
    posted_at: '2026-02-20T00:00:00+00:00',
    amount: -50,
    currency: 'USD',
    description_raw: 'Coffee Shop',
    description_norm: 'COFFEE SHOP',
    is_pending: false,
    category_id: 1,
    category_name: 'Food',
    merchant_id: null,
    merchant_name: null,
    transfer_id: null,
    notes: null
  },
  {
    id: '2',
    account_id: 'a2',
    account_name: 'Credit',
    account_type: 'credit',
    posted_at: '2026-02-21T00:00:00+00:00',
    amount: -100,
    currency: 'USD',
    description_raw: 'Gas Station',
    description_norm: 'GAS STATION',
    is_pending: true,
    category_id: 2,
    category_name: 'Transportation',
    merchant_id: null,
    merchant_name: null,
    transfer_id: null,
    notes: null
  }
];

describe('applyTransactionFilters', () => {
  it('filters by query, amount, and pending flag', () => {
    const filtered = applyTransactionFilters(txns as any, {
      q: 'coffee',
      accountId: '',
      categoryId: '',
      minAmount: '20',
      maxAmount: '60',
      includePending: false
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });
});
