import type { Transaction } from '../types';

export type TxnFilterInput = {
  q: string;
  accountId: string;
  categoryId: string;
  minAmount: string;
  maxAmount: string;
  includePending: boolean;
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

type ParsedSearchQuery = {
  strictPhrases: string[];
  fuzzyTerms: string[];
};

function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const strictPhrases = Array.from(
    rawQuery.toLowerCase().matchAll(/"([^"]+)"/g),
    (match) => match[1].trim()
  ).filter(Boolean);
  const remainder = rawQuery.replace(/"[^"]+"/g, ' ');
  return {
    strictPhrases,
    fuzzyTerms: tokenize(remainder)
  };
}

function buildBigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  const output = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    output.add(value.slice(index, index + 2));
  }
  return output;
}

function diceSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return 0;

  let shared = 0;
  leftBigrams.forEach((token) => {
    if (rightBigrams.has(token)) shared += 1;
  });
  return (2 * shared) / (leftBigrams.size + rightBigrams.size);
}

function scoreTokenMatch(queryToken: string, fieldToken: string): number {
  if (queryToken === fieldToken) return 1;
  if (queryToken.length < 3 || fieldToken.length < 3) return 0;
  if (
    fieldToken.startsWith(queryToken) ||
    queryToken.startsWith(fieldToken)
  ) {
    return 0.92;
  }
  if (
    fieldToken.includes(queryToken) ||
    queryToken.includes(fieldToken)
  ) {
    return 0.78;
  }
  return diceSimilarity(queryToken, fieldToken);
}

function scoreFieldMatch(query: string, queryTokens: string[], value: string): number {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes(query)) return 1.2;

  const fieldTokens = tokenize(normalized);
  if (!fieldTokens.length) return 0;

  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const fieldToken of fieldTokens) {
      best = Math.max(best, scoreTokenMatch(queryToken, fieldToken));
      if (best >= 1) break;
    }
    total += best;
  }

  const average = total / queryTokens.length;
  return average >= 0.55 ? average : 0;
}

function matchesStrictPhrases(
  transaction: Transaction,
  strictPhrases: string[]
): boolean {
  if (!strictPhrases.length) return true;
  const haystacks = [
    transaction.description_norm,
    transaction.description_raw,
    transaction.merchant_name ?? '',
    transaction.category_name ?? '',
    transaction.account_name,
    transaction.notes ?? ''
  ].map((value) => value.toLowerCase());

  return strictPhrases.every((phrase) =>
    haystacks.some((value) => value.includes(phrase))
  );
}

export function scoreTransactionSearch(
  transaction: Transaction,
  rawQuery: string
): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 0;
  const parsed = parseSearchQuery(query);
  if (!matchesStrictPhrases(transaction, parsed.strictPhrases)) return 0;
  const queryTokens = parsed.fuzzyTerms;
  if (!queryTokens.length) {
    return parsed.strictPhrases.length > 0 ? 2 : 0;
  }

  const weightedFields = [
    { value: transaction.description_norm, weight: 1 },
    { value: transaction.description_raw, weight: 0.96 },
    { value: transaction.merchant_name ?? '', weight: 0.88 },
    { value: transaction.category_name ?? '', weight: 0.84 },
    { value: transaction.account_name, weight: 0.7 },
    { value: transaction.notes ?? '', weight: 0.6 }
  ];

  let best = 0;
  let matchedFields = 0;
  for (const field of weightedFields) {
    const score = scoreFieldMatch(query, queryTokens, field.value);
    if (score > 0) {
      matchedFields += 1;
      best = Math.max(best, score * field.weight);
    }
  }

  if (best === 0) return 0;
  return best + Math.min(0.08, (matchedFields - 1) * 0.02);
}

export function applyTransactionFilters(
  transactions: Transaction[],
  filters: TxnFilterInput
): Transaction[] {
  const q = filters.q.trim();
  const minAmount = filters.minAmount ? Number(filters.minAmount) : null;
  const maxAmount = filters.maxAmount ? Number(filters.maxAmount) : null;
  const matches: { txn: Transaction; score: number }[] = [];

  transactions.forEach((txn) => {
    if (!filters.includePending && txn.is_pending) {
      return;
    }
    if (filters.accountId && txn.account_id !== filters.accountId) {
      return;
    }
    if (
      filters.categoryId &&
      String(txn.category_id ?? '') !== filters.categoryId
    ) {
      return;
    }
    if (minAmount !== null && Math.abs(txn.amount) < minAmount) {
      return;
    }
    if (maxAmount !== null && Math.abs(txn.amount) > maxAmount) {
      return;
    }

    const score = q ? scoreTransactionSearch(txn, q) : 0;
    if (q && score <= 0) {
      return;
    }

    matches.push({ txn, score });
  });

  if (!q) {
    return matches.map((entry) => entry.txn);
  }

  return matches
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (
        new Date(right.txn.posted_at).getTime() -
        new Date(left.txn.posted_at).getTime()
      );
    })
    .map((entry) => entry.txn);
}
