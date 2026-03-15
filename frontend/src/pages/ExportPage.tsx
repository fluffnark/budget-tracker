import { useMemo, useState } from 'react';

import { apiFetch } from '../api';
import type { SheetsExportResponse } from '../types';

function quoteCsvCell(value: string | number | boolean | null) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toDelimited(
  columns: string[],
  rows: Array<Array<string | number | boolean | null>>,
  delimiter: ',' | '\t'
) {
  const escape = delimiter === ',' ? quoteCsvCell : (value: string | number | boolean | null) => String(value ?? '');
  return [
    columns.map((cell) => escape(cell)).join(delimiter),
    ...rows.map((row) => row.map((cell) => escape(cell)).join(delimiter))
  ].join('\n');
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
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

function downloadText(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildExportQuery(params: {
  start: string;
  end: string;
  scrub: boolean;
  hashMerchants: boolean;
  roundAmounts: boolean;
}) {
  return new URLSearchParams({
    start: params.start,
    end: params.end,
    scrub: params.scrub ? '1' : '0',
    hash_merchants: params.hashMerchants ? '1' : '0',
    round_amounts: params.roundAmounts ? '1' : '0'
  });
}

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
  const [llmPayload, setLlmPayload] = useState<any | null>(null);
  const [sheetsPayload, setSheetsPayload] = useState<SheetsExportResponse | null>(null);
  const [activeSheetName, setActiveSheetName] = useState('');
  const [message, setMessage] = useState('');

  const pretty = useMemo(
    () => (llmPayload ? JSON.stringify(llmPayload, null, 2) : ''),
    [llmPayload]
  );

  const activeSheet = useMemo(
    () =>
      sheetsPayload?.sheets.find((sheet) => sheet.name === activeSheetName) ??
      sheetsPayload?.sheets[0] ??
      null,
    [activeSheetName, sheetsPayload]
  );

  const activeSheetCsv = useMemo(
    () =>
      activeSheet ? toDelimited(activeSheet.columns, activeSheet.rows, ',') : '',
    [activeSheet]
  );
  const activeSheetTsv = useMemo(
    () =>
      activeSheet ? toDelimited(activeSheet.columns, activeSheet.rows, '\t') : '',
    [activeSheet]
  );

  const exportQuery = useMemo(
    () =>
      buildExportQuery({
        start,
        end,
        scrub,
        hashMerchants,
        roundAmounts
      }),
    [end, hashMerchants, roundAmounts, scrub, start]
  );

  async function runLlmExport() {
    const result = await apiFetch<any>(`/api/export/llm?${exportQuery.toString()}`);
    setLlmPayload(result);
    setMessage('LLM export generated.');
  }

  async function runSheetsExport() {
    const result = await apiFetch<SheetsExportResponse>(
      `/api/export/sheets?${exportQuery.toString()}`
    );
    setSheetsPayload(result);
    setActiveSheetName(result.sheets[0]?.name ?? '');
    setMessage('Sheets export generated.');
  }

  async function copyJsonToClipboard() {
    if (!llmPayload) return;
    await copyText(pretty);
    setMessage('Copied JSON export.');
  }

  async function copySheetForPaste() {
    if (!activeSheetTsv) return;
    await copyText(activeSheetTsv);
    setMessage(`Copied ${activeSheet?.name} as tab-separated rows.`);
  }

  function downloadJson() {
    if (!llmPayload) return;
    downloadText('export.json', pretty, 'application/json');
  }

  function downloadSheetCsv() {
    if (!activeSheet || !activeSheetCsv) return;
    const workbookName = sheetsPayload?.workbook_name ?? 'budget-tracker-export';
    downloadText(`${workbookName}-${activeSheet.name}.csv`, activeSheetCsv, 'text/csv;charset=utf-8');
  }

  function downloadAllSheets() {
    const basePath = import.meta.env.BASE_URL || '/';
    const resolvedPath = `${basePath.replace(/\/$/, '')}/api/export/sheets.zip?${exportQuery.toString()}`;
    const anchor = document.createElement('a');
    anchor.href = resolvedPath;
    anchor.download = `${sheetsPayload?.workbook_name ?? 'budget-tracker-export'}.zip`;
    anchor.click();
    setMessage('Downloading all sheets as a zip.');
  }

  function downloadSheetsWorkbook() {
    const basePath = import.meta.env.BASE_URL || '/';
    const resolvedPath = `${basePath.replace(/\/$/, '')}/api/export/sheets.xlsx?${exportQuery.toString()}`;
    const anchor = document.createElement('a');
    anchor.href = resolvedPath;
    anchor.download = `${sheetsPayload?.workbook_name ?? 'budget-tracker-export'}.xlsx`;
    anchor.click();
    setMessage('Downloading analytics workbook as .xlsx.');
  }

  return (
    <section>
      <h2>Export</h2>
      {message && <p className="toast">{message}</p>}
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
      </div>

      <article className="card">
        <div className="jump-header">
          <div>
            <h3>Sheets Export</h3>
            <p className="category-editor-note">
              Generates flat tabs for `transactions`, monthly rollups, category rollups,
              account snapshots, and built-in analytics summaries. Download the full
              workbook as `.xlsx`, copy the active tab into Google Sheets, or import
              the CSV per tab.
            </p>
          </div>
          <div className="row-actions">
            <button onClick={runSheetsExport}>Generate Sheets Export</button>
            <button className="secondary" onClick={copySheetForPaste} disabled={!activeSheet}>
              Copy active tab for Sheets
            </button>
            <button className="secondary" onClick={downloadSheetCsv} disabled={!activeSheet}>
              Download active tab CSV
            </button>
            <button className="secondary" onClick={downloadSheetsWorkbook}>
              Download workbook .xlsx
            </button>
            <button className="secondary" onClick={downloadAllSheets}>
              Download all tabs
            </button>
          </div>
        </div>
        {sheetsPayload && (
          <>
            <p className="category-editor-note">
              Workbook: <strong>{sheetsPayload.workbook_name}</strong>
            </p>
            <div className="toolbar tabs">
              {sheetsPayload.sheets.map((sheet) => (
                <button
                  key={sheet.name}
                  type="button"
                  className={`tab-button ${activeSheet?.name === sheet.name ? 'active' : ''}`}
                  onClick={() => setActiveSheetName(sheet.name)}
                >
                  {sheet.name} ({sheet.rows.length})
                </button>
              ))}
            </div>
            {activeSheet && (
              <div className="export-sheet-wrap">
                <table className="export-sheet-table">
                  <thead>
                    <tr>
                      {activeSheet.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.rows.slice(0, 20).map((row, rowIndex) => (
                      <tr key={`${activeSheet.name}-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${activeSheet.name}-${rowIndex}-${cellIndex}`}>
                            {cell === null ? '' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {activeSheet.rows.length > 20 && (
                  <p className="category-editor-note">
                    Previewing first 20 rows of {activeSheet.rows.length}.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </article>

      <article className="card">
        <div className="jump-header">
          <div>
            <h3>LLM Export</h3>
            <p className="category-editor-note">
              Keeps the privacy-scrubbed JSON export for LLM workflows.
            </p>
          </div>
          <div className="row-actions">
            <button onClick={runLlmExport}>Export for LLM</button>
            <button className="secondary" onClick={copyJsonToClipboard} disabled={!llmPayload}>
              Copy JSON
            </button>
            <button className="secondary" onClick={downloadJson} disabled={!llmPayload}>
              Download JSON
            </button>
          </div>
        </div>
        {llmPayload && (
          <>
            <h4>Prompt Template</h4>
            <p>{llmPayload.prompt_template}</p>
            <textarea readOnly rows={14} value={pretty} />
          </>
        )}
      </article>
    </section>
  );
}
