import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../api';
import type { Account, Transaction } from '../types';

export function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [includePending, setIncludePending] = useState(true);

  useEffect(() => {
    apiFetch<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
    apiFetch<Transaction[]>('/api/transactions?limit=250&include_transfers=0')
      .then(setTransactions)
      .catch(() => setTransactions([]));
  }, []);

  const netWorth = useMemo(
    () => accounts.reduce((sum, acct) => sum + (acct.balance ?? 0), 0),
    [accounts]
  );

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthTxns = transactions.filter((txn) =>
    txn.posted_at.startsWith(monthKey)
  );
  const filtered = includePending
    ? monthTxns
    : monthTxns.filter((txn) => !txn.is_pending);

  const inflow = filtered
    .filter((txn) => txn.amount > 0)
    .reduce((s, txn) => s + txn.amount, 0);
  const outflow = filtered
    .filter((txn) => txn.amount < 0)
    .reduce((s, txn) => s + Math.abs(txn.amount), 0);

  return (
    <section>
      <h2>Dashboard</h2>
      <div className="grid two">
        <article className="card">
          <h3>Net Worth</h3>
          <p className="big">${netWorth.toFixed(2)}</p>
        </article>
        <article className="card">
          <h3>This Month</h3>
          <label className="inline">
            <input
              type="checkbox"
              checked={includePending}
              onChange={(e) => setIncludePending(e.target.checked)}
            />
            Include pending
          </label>
          <p>Inflow: ${inflow.toFixed(2)}</p>
          <p>Outflow: ${outflow.toFixed(2)}</p>
          <p>Net: ${(inflow - outflow).toFixed(2)}</p>
        </article>
      </div>
      <article className="card">
        <h3>Sync Alerts</h3>
        <ul>
          {accounts.map((acct) => (
            <li key={acct.id}>
              {acct.name}: last sync{' '}
              {acct.last_sync_at
                ? new Date(acct.last_sync_at).toLocaleString()
                : 'never'}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
