import { useMemo, useState } from 'react';

import { apiFetch } from '../api';

export function ExportPage() {
  const [start, setStart] = useState(
    new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .slice(0, 10)
  );
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [scrub, setScrub] = useState(true);
  const [hashMerchants, setHashMerchants] = useState(true);
  const [roundAmounts, setRoundAmounts] = useState(false);
  const [payload, setPayload] = useState<any | null>(null);

  const pretty = useMemo(
    () => (payload ? JSON.stringify(payload, null, 2) : ''),
    [payload]
  );

  async function runExport() {
    const query = new URLSearchParams({
      start,
      end,
      scrub: scrub ? '1' : '0',
      hash_merchants: hashMerchants ? '1' : '0',
      round_amounts: roundAmounts ? '1' : '0'
    });
    const result = await apiFetch<any>(`/api/export/llm?${query.toString()}`);
    setPayload(result);
  }

  async function copyToClipboard() {
    if (!payload) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(pretty);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = pretty;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!ok) {
      throw new Error('Clipboard copy is unavailable in this browser context.');
    }
  }

  function downloadJson() {
    if (!payload) return;
    const blob = new Blob([pretty], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'export.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2>Export for LLM</h2>
      <div className="card filters">
        <label>
          Start
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          End
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={scrub}
            onChange={(e) => setScrub(e.target.checked)}
          />
          Privacy scrub
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={hashMerchants}
            onChange={(e) => setHashMerchants(e.target.checked)}
          />
          Hash merchants
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={roundAmounts}
            onChange={(e) => setRoundAmounts(e.target.checked)}
          />
          Round amounts
        </label>
        <button onClick={runExport}>Export for LLM</button>
        <button className="secondary" onClick={copyToClipboard}>
          Copy to clipboard
        </button>
        <button className="secondary" onClick={downloadJson}>
          Download JSON
        </button>
      </div>
      {payload && (
        <article className="card">
          <h3>Prompt Template</h3>
          <p>{payload.prompt_template}</p>
          <textarea readOnly rows={14} value={pretty} />
        </article>
      )}
    </section>
  );
}
