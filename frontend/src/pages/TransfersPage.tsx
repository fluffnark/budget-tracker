import { useEffect, useState } from 'react';

import { apiFetch } from '../api';
import type { Transfer } from '../types';

export function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  async function load() {
    const rows = await apiFetch<Transfer[]>('/api/transfers');
    setTransfers(rows);
  }

  useEffect(() => {
    load().catch(() => setTransfers([]));
  }, []);

  async function patchStatus(id: number, status: string) {
    await apiFetch(`/api/transfers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await load();
  }

  return (
    <section>
      <h2>Transfer Review</h2>
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Out Txn</th>
            <th>In Txn</th>
            <th>Confidence</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td>{t.txn_out_id.slice(0, 8)}</td>
              <td>{t.txn_in_id.slice(0, 8)}</td>
              <td>{t.confidence.toFixed(2)}</td>
              <td>{t.status}</td>
              <td>
                <button onClick={() => patchStatus(t.id, 'confirmed')}>
                  Confirm
                </button>
                <button
                  className="danger"
                  onClick={() => patchStatus(t.id, 'rejected')}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
