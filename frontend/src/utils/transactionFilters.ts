import type { Transaction } from '../types';

export type TxnFilterInput = {
  q: string;
  accountId: string;
  categoryId: string;
  minAmount: string;
  maxAmount: string;
  includePending: boolean;
};

export function applyTransactionFilters(
  transactions: Transaction[],
  filters: TxnFilterInput
): Transaction[] {
  const q = filters.q.trim().toLowerCase();
  const minAmount = filters.minAmount ? Number(filters.minAmount) : null;
  const maxAmount = filters.maxAmount ? Number(filters.maxAmount) : null;

  return transactions.filter((txn) => {
    if (!filters.includePending && txn.is_pending) {
      return false;
    }
    if (filters.accountId && txn.account_id !== filters.accountId) {
      return false;
    }
    if (
      filters.categoryId &&
      String(txn.category_id ?? '') !== filters.categoryId
    ) {
      return false;
    }
    if (minAmount !== null && Math.abs(txn.amount) < minAmount) {
      return false;
    }
    if (maxAmount !== null && Math.abs(txn.amount) > maxAmount) {
      return false;
    }
    if (q) {
      const haystack =
        `${txn.description_norm} ${txn.description_raw} ${txn.account_name}`.toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    return true;
  });
}
