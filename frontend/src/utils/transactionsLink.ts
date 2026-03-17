type TransactionsLinkArgs = {
  start: string;
  end: string;
  includePending?: boolean;
  includeTransfers?: boolean;
  accountId?: string | null;
  categoryId?: number | null;
  categoryFamily?: string | null;
  q?: string | null;
  preset?: string;
};

export function buildTransactionsHref({
  start,
  end,
  includePending = true,
  includeTransfers = false,
  accountId = null,
  categoryId = null,
  categoryFamily = null,
  q = null,
  preset = 'custom'
}: TransactionsLinkArgs): string {
  const params = new URLSearchParams();
  params.set('preset', preset);
  params.set('start', start);
  params.set('end', end);
  if (accountId) params.set('account_id', accountId);
  if (categoryId) params.set('category_id', String(categoryId));
  if (categoryFamily) params.set('category_family', categoryFamily);
  if (q) params.set('q', q);
  if (!includePending) params.set('pending', '0');
  if (includeTransfers) params.set('transfers', '1');
  return `/transactions?${params.toString()}`;
}
