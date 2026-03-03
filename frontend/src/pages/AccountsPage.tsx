import { useEffect, useState } from 'react';

import { apiFetch } from '../api';
import type { Account } from '../types';

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    apiFetch<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  return (
    <section>
      <h2>Accounts</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Institution</th>
            <th>Name</th>
            <th>Type</th>
            <th>Balance</th>
            <th>Available</th>
            <th>Last Sync</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((acct) => (
            <tr key={acct.id}>
              <td>{acct.institution_name ?? '-'}</td>
              <td>{acct.name}</td>
              <td>{acct.type}</td>
              <td>{acct.balance?.toFixed(2) ?? '-'}</td>
              <td>{acct.available_balance?.toFixed(2) ?? '-'}</td>
              <td>
                {acct.last_sync_at
                  ? new Date(acct.last_sync_at).toLocaleString()
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
