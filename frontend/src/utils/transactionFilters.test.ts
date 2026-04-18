import { describe, expect, it } from 'vitest';

import {
  applyTransactionFilters,
  scoreTransactionSearch
} from './transactionFilters';

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
    notes: null,
    manual_category_override: false,
    is_reviewed: false,
    reviewed_at: null
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
    notes: null,
    manual_category_override: false,
    is_reviewed: false,
    reviewed_at: null
  },
  {
    id: '3',
    account_id: 'a3',
    account_name: 'Savings',
    account_type: 'savings',
    posted_at: '2026-02-22T00:00:00+00:00',
    amount: -75,
    currency: 'USD',
    description_raw: 'Whole Foods Market',
    description_norm: 'WHOLE FOODS MARKET',
    is_pending: false,
    category_id: 3,
    category_name: 'Groceries',
    merchant_id: 9,
    merchant_name: 'Whole Foods',
    transfer_id: null,
    notes: 'Weekly grocery run',
    manual_category_override: false,
    is_reviewed: true,
    reviewed_at: '2026-02-22T00:00:00+00:00'
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
      includePending: false,
      reviewState: 'all'
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('matches similar spellings and category keywords', () => {
    const fuzzy = applyTransactionFilters(txns as any, {
      q: 'cofee',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'all'
    });
    const category = applyTransactionFilters(txns as any, {
      q: 'grocery',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'all'
    });

    expect(fuzzy[0].id).toBe('1');
    expect(category[0].id).toBe('3');
  });

  it('scores direct description matches above weaker account matches', () => {
    expect(scoreTransactionSearch(txns[0] as any, 'coffee')).toBeGreaterThan(
      scoreTransactionSearch(txns[0] as any, 'checking')
    );
  });

  it('supports exact phrase matching with quotes', () => {
    const exact = applyTransactionFilters(txns as any, {
      q: '"coffee shop"',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'all'
    });
    const mixed = applyTransactionFilters(txns as any, {
      q: '"whole foods" grocery',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'all'
    });
    const miss = applyTransactionFilters(txns as any, {
      q: '"coffee market"',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'all'
    });

    expect(exact.map((txn: any) => txn.id)).toEqual(['1']);
    expect(mixed.map((txn: any) => txn.id)).toEqual(['3']);
    expect(miss).toHaveLength(0);
  });

  it('filters by review state', () => {
    const needsReview = applyTransactionFilters(txns as any, {
      q: '',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'needs_review'
    });
    const reviewed = applyTransactionFilters(txns as any, {
      q: '',
      accountId: '',
      categoryId: '',
      minAmount: '',
      maxAmount: '',
      includePending: true,
      reviewState: 'reviewed'
    });

    expect(needsReview.map((txn: any) => txn.id)).toEqual(['1', '2']);
    expect(reviewed.map((txn: any) => txn.id)).toEqual(['3']);
  });
});
