import type { Account } from '../types';

const LIABILITY_TYPE_TOKENS = ['credit', 'credit_card', 'loan', 'mortgage', 'liability', 'debt'];
const LIABILITY_NAME_TOKENS = ['mortgage', 'credit', 'visa', 'mastercard', 'amex', 'loan', 'debt'];

export function isLiabilityAccount(account: Pick<Account, 'type' | 'name'>): boolean {
  const type = account.type.toLowerCase();
  const name = account.name.toLowerCase();
  return (
    LIABILITY_TYPE_TOKENS.some((token) => type.includes(token)) ||
    LIABILITY_NAME_TOKENS.some((token) => name.includes(token))
  );
}
