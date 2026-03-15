import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../api';
import { SectionLayout } from '../components/SectionLayout';
import { applyThemeMode, readThemeMode, type ThemeMode } from '../themeMode';
import type {
  AuthStatus,
  AdvisorEmailPreviewResponse,
  AdvisorEmailSendResponse,
  AdvisorReportGenerateResponse,
  Settings,
  SyncStatus
} from '../types';

const CUSTOM_GROUPS_KEY = 'bt_accounts_custom_groups_v1';
const GROUP_ORDER_KEY = 'bt_accounts_group_order_v1';
const COLLAPSED_KEY = 'bt_accounts_collapsed_types_v1';
const GROUP_PREFS_KEY = 'bt_accounts_group_prefs_v1';
const ACCOUNT_GROUP_ASSIGN_KEY = 'bt_accounts_account_group_assign_v1';

type CustomGroup = { key: string; label: string; icon: string };

function parseCustomGroups(value: string | null): CustomGroup[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const row = item as { key?: unknown; label?: unknown; icon?: unknown };
        if (typeof row.key !== 'string') return null;
        return {
          key: row.key,
          label: typeof row.label === 'string' ? row.label : row.key,
          icon: typeof row.icon === 'string' ? row.icon : ''
        } satisfies CustomGroup;
      })
      .filter((item): item is CustomGroup => Boolean(item));
  } catch {
    return [];
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseObjectRecord(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, row] of Object.entries(parsed ?? {})) {
      if (typeof row === 'string') out[key] = row;
    }
    return out;
  } catch {
    return {};
  }
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
  if (!ok) throw new Error('Clipboard copy is unavailable in this browser context.');
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [message, setMessage] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [claiming, setClaiming] = useState(false);
  const [syncing, setSyncing] = useState<null | 'sync' | 'backfill'>(null);
  const [saving, setSaving] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerCurrentPassword, setOwnerCurrentPassword] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [reportDays, setReportDays] = useState(30);
  const [reportEndDate, setReportEndDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [includePending, setIncludePending] = useState(true);
  const [includeTransfers, setIncludeTransfers] = useState(false);
  const [hashMerchants, setHashMerchants] = useState(true);
  const [roundAmounts, setRoundAmounts] = useState(false);
  const [advisorReport, setAdvisorReport] = useState<AdvisorReportGenerateResponse | null>(null);
  const [advisorResponse, setAdvisorResponse] = useState('');
  const [emailPreview, setEmailPreview] = useState<AdvisorEmailPreviewResponse | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reportRecipients, setReportRecipients] = useState('');

  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(() =>
    parseCustomGroups(
      typeof window !== 'undefined' ? window.localStorage.getItem(CUSTOM_GROUPS_KEY) : null
    )
  );
  const [groupOrder, setGroupOrder] = useState<string[]>(() =>
    parseStringArray(
      typeof window !== 'undefined' ? window.localStorage.getItem(GROUP_ORDER_KEY) : null
    )
  );
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupIcon, setNewGroupIcon] = useState('');

  async function load() {
    const s = await apiFetch<Settings>('/api/settings');
    const auth = await apiFetch<AuthStatus>('/api/auth/status');
    setSettings(s);
    setAuthStatus(auth);
    setOwnerEmail(auth.owner_email ?? '');
    setReportRecipients(s.email_report_recipients);
  }

  useEffect(() => {
    load().catch(() => setSettings(null));
    setThemeMode(readThemeMode());
    apiFetch<SyncStatus>('/api/sync/status').then(setSyncStatus).catch(() => null);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(customGroups));
  }, [customGroups]);

  useEffect(() => {
    window.localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));
  }, [groupOrder]);

  const recipientList = useMemo(
    () =>
      reportRecipients
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    [reportRecipients]
  );

  function onThemeChange(next: ThemeMode) {
    setThemeMode(next);
    applyThemeMode(next);
  }

  async function claimToken() {
    setClaiming(true);
    try {
      await apiFetch('/api/simplefin/claim', {
        method: 'POST',
        body: JSON.stringify({ setup_token: setupToken })
      });
      setMessage('SimpleFIN connection saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword) {
      setMessage('Enter the current password and a new password.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setMessage('New passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setMessage('Password updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setChangingPassword(false);
    }
  }

  async function changeOwnerEmail() {
    if (!ownerEmail.trim()) {
      setMessage('Enter an owner email.');
      return;
    }
    if (!ownerCurrentPassword) {
      setMessage('Enter the current password to change the username.');
      return;
    }
    setChangingEmail(true);
    try {
      const next = await apiFetch<{ email: string }>('/api/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({
          email: ownerEmail,
          current_password: ownerCurrentPassword
        })
      });
      setOwnerCurrentPassword('');
      setAuthStatus((prev) =>
        prev
          ? {
              ...prev,
              owner_email: next.email
            }
          : prev
      );
      setOwnerEmail(next.email);
      setMessage('Owner username updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Username change failed');
    } finally {
      setChangingEmail(false);
    }
  }

  async function runSync(forceBackfill = false) {
    let pollTimer: number | null = null;
    setSyncing(forceBackfill ? 'backfill' : 'sync');
    try {
      if (forceBackfill) {
        const poll = () =>
          apiFetch<SyncStatus>('/api/sync/status')
            .then(setSyncStatus)
            .catch(() => null);
        await poll();
        pollTimer = window.setInterval(poll, 800);
      }
      await apiFetch('/api/sync/run', {
        method: 'POST',
        body: JSON.stringify({
          balances_only: false,
          force_backfill: forceBackfill
        })
      });
      setMessage(
        forceBackfill
          ? 'Historical backfill sync complete.'
          : 'Manual sync complete.'
      );
      const status = await apiFetch<SyncStatus>('/api/sync/status');
      setSyncStatus(status);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      setSyncing(null);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await apiFetch<Settings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          sync_daily_hour: settings.sync_daily_hour,
          sync_daily_minute: settings.sync_daily_minute,
          scrub_default: settings.scrub_default
        })
      });
      setSettings(next);
      setMessage('Settings updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveEmailSettings() {
    if (!settings) return;
    setSavingEmail(true);
    try {
      const next = await apiFetch<Settings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          email_reports_enabled: settings.email_reports_enabled,
          email_report_day: settings.email_report_day,
          email_report_hour: settings.email_report_hour,
          email_report_minute: settings.email_report_minute,
          email_report_recipients: reportRecipients,
          smtp_host: settings.smtp_host,
          smtp_port: settings.smtp_port,
          smtp_username: settings.smtp_username,
          smtp_password: smtpPassword || undefined,
          smtp_from: settings.smtp_from,
          smtp_use_tls: settings.smtp_use_tls,
          smtp_use_ssl: settings.smtp_use_ssl
        })
      });
      setSettings(next);
      setSmtpPassword('');
      setMessage('Email settings saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Email settings save failed');
    } finally {
      setSavingEmail(false);
    }
  }

  function applyGmailDefaults() {
    if (!settings) return;
    setSettings({
      ...settings,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_use_tls: true,
      smtp_use_ssl: false
    });
    setMessage('Applied Gmail defaults. Save to persist.');
  }

  async function generateAdvisorReport() {
    setReportLoading(true);
    try {
      const result = await apiFetch<AdvisorReportGenerateResponse>(
        '/api/advisor/report/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            days: reportDays,
            end_date: reportEndDate,
            include_pending: includePending,
            include_transfers: includeTransfers,
            hash_merchants: hashMerchants,
            round_amounts: roundAmounts
          })
        }
      );
      setAdvisorReport(result);
      setEmailPreview(null);
      setMessage('Advisor prompt generated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setReportLoading(false);
    }
  }

  async function previewAdvisorEmail() {
    setPreviewLoading(true);
    try {
      const preview = await apiFetch<AdvisorEmailPreviewResponse>(
        '/api/advisor/report/email/preview',
        {
          method: 'POST',
          body: JSON.stringify({
            days: reportDays,
            end_date: reportEndDate,
            include_pending: includePending,
            include_transfers: includeTransfers,
            hash_merchants: hashMerchants,
            round_amounts: roundAmounts,
            advisor_response: advisorResponse,
            recipients: reportRecipients
          })
        }
      );
      setEmailPreview(preview);
      setMessage('Email preview generated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function sendAdvisorEmail() {
    setEmailSending(true);
    try {
      const result = await apiFetch<AdvisorEmailSendResponse>(
        '/api/advisor/report/email/send',
        {
          method: 'POST',
          body: JSON.stringify({
            days: reportDays,
            end_date: reportEndDate,
            include_pending: includePending,
            include_transfers: includeTransfers,
            hash_merchants: hashMerchants,
            round_amounts: roundAmounts,
            advisor_response: advisorResponse,
            recipients: reportRecipients
          })
        }
      );
      if (!result.sent) {
        setMessage(`Email not sent: ${result.reason ?? 'unknown reason'}`);
      } else {
        setMessage(`Email sent to ${result.recipient_count} recipient(s).`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setEmailSending(false);
    }
  }

  function createCustomGroup() {
    const label = newGroupName.trim();
    if (!label) return;
    const key = `custom:${Date.now().toString(36)}`;
    setCustomGroups((prev) => [...prev, { key, label, icon: newGroupIcon.trim() }]);
    setGroupOrder((prev) => [key, ...prev]);
    setNewGroupName('');
    setNewGroupIcon('');
    setMessage(`Created group "${label}".`);
  }

  function deleteCustomGroup(key: string) {
    setCustomGroups((prev) => prev.filter((group) => group.key !== key));
    setGroupOrder((prev) => prev.filter((item) => item !== key));
    const collapsed = parseStringArray(window.localStorage.getItem(COLLAPSED_KEY)).filter(
      (item) => item !== key
    );
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));

    const groupPrefs = parseObjectRecord(window.localStorage.getItem(GROUP_PREFS_KEY));
    delete groupPrefs[key];
    window.localStorage.setItem(GROUP_PREFS_KEY, JSON.stringify(groupPrefs));

    const assignments = parseObjectRecord(window.localStorage.getItem(ACCOUNT_GROUP_ASSIGN_KEY));
    for (const accountId of Object.keys(assignments)) {
      if (assignments[accountId] === key) delete assignments[accountId];
    }
    window.localStorage.setItem(ACCOUNT_GROUP_ASSIGN_KEY, JSON.stringify(assignments));
    setMessage('Removed custom group.');
  }

  const backfillProgressPct = Math.round((syncStatus?.progress ?? 0) * 100);
  const isBackfillActive =
    syncing === 'backfill' || (syncStatus?.running && syncStatus.mode === 'backfill');

  return (
    <SectionLayout
      pageKey="settings"
      title="Settings"
      intro={message ? <p className="toast">{message}</p> : undefined}
      sections={[
        {
          id: 'settings-owner',
          label: 'Owner Access',
          content: (
            <div className="filters">
              <p>
                Owner account: <strong>{authStatus?.owner_email ?? 'not configured'}</strong>
              </p>
              <p className="category-editor-note">
                This app is designed for one local owner account. Change the password here instead of creating additional users.
              </p>
              <label>
                Username / email
                <input
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Current password for username change
                <input
                  type="password"
                  value={ownerCurrentPassword}
                  onChange={(e) => setOwnerCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <button
                type="button"
                onClick={changeOwnerEmail}
                disabled={changingEmail}
              >
                {changingEmail ? 'Updating username...' : 'Change username'}
              </button>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <small>Use at least 10 characters.</small>
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <button
                type="button"
                onClick={changePassword}
                disabled={changingPassword}
              >
                {changingPassword ? 'Updating password...' : 'Change password'}
              </button>
            </div>
          )
        },
        {
          id: 'settings-connection',
          label: 'Connection',
          content: (
            <div className="filters">
              <div className="settings-instructions">
                <h4>Link SimpleFIN accounts</h4>
                <ol>
                  <li>Open your financial institution inside SimpleFIN Bridge.</li>
                  <li>Copy the one-time setup token or returned access URL.</li>
                  <li>Paste it here and claim the connection.</li>
                  <li>Run `Sync now` for a normal pull or `Backfill history` for the initial import.</li>
                </ol>
                <p className="category-editor-note">
                  Tokens are single-use. If claim fails after one attempt, generate a fresh token in SimpleFIN.
                </p>
                <p className="category-editor-note">
                  Connection status: {authStatus?.simplefin_connected ? authStatus.simplefin_status ?? 'connected' : 'not connected'}
                </p>
              </div>
              <label>
                SimpleFIN setup token
                <textarea
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  rows={3}
                  placeholder="Paste setup token"
                />
              </label>
              <button
                onClick={claimToken}
                disabled={claiming || !setupToken.trim()}
                className={claiming ? 'button-loading' : ''}
              >
                {claiming ? 'Claiming...' : 'Claim token'}
              </button>
              <button
                className={`secondary ${syncing === 'sync' ? 'button-loading' : ''}`}
                onClick={() => runSync(false)}
                disabled={syncing !== null}
              >
                {syncing === 'sync' ? 'Syncing...' : 'Sync now'}
              </button>
              <button
                className={`secondary ${
                  syncing === 'backfill' ? 'button-loading' : ''
                }`}
                onClick={() => runSync(true)}
                disabled={syncing !== null}
              >
                {syncing === 'backfill' ? 'Backfilling...' : 'Backfill history'}
              </button>
              {isBackfillActive && (
                <div className="sync-progress-wrap" aria-live="polite">
                  <div className="sync-progress-head">
                    <strong>Backfill progress</strong>
                    <span>
                      {syncStatus?.current_window ?? 0}/
                      {syncStatus?.total_windows ?? 0} windows
                    </span>
                  </div>
                  <progress
                    className="sync-progress"
                    value={backfillProgressPct}
                    max={100}
                  />
                  <div className="sync-progress-meta">
                    <span>{backfillProgressPct}%</span>
                    <span>{syncStatus?.message ?? 'running'}</span>
                  </div>
                </div>
              )}
            </div>
          )
        },
        {
          id: 'settings-appearance',
          label: 'Appearance',
          content: (
            <div className="filters">
              <label>
                Theme
                <select
                  value={themeMode}
                  onChange={(e) => onThemeChange(e.target.value as ThemeMode)}
                >
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              {settings && (
                <p className="category-editor-note">
                  Auto-categorization:{' '}
                  {settings.auto_categorization ? 'Enabled' : 'Disabled'}
                </p>
              )}
            </div>
          )
        },
        {
          id: 'settings-schedule',
          label: 'Sync & Export Defaults',
          defaultCollapsed: true,
          content: settings ? (
            <div className="filters">
              <p>Mock mode: {settings.simplefin_mock ? 'ON' : 'OFF'}</p>
              <label>
                Daily sync hour (UTC)
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={settings.sync_daily_hour}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sync_daily_hour: Number(e.target.value)
                    })
                  }
                />
              </label>
              <label>
                Daily sync minute (UTC)
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={settings.sync_daily_minute}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sync_daily_minute: Number(e.target.value)
                    })
                  }
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={settings.scrub_default}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      scrub_default: e.target.checked
                    })
                  }
                />
                Default export scrub
              </label>
              <button
                onClick={saveSettings}
                disabled={saving}
                className={saving ? 'button-loading' : ''}
              >
                {saving ? 'Saving...' : 'Save schedule'}
              </button>
            </div>
          ) : (
            <p>Settings unavailable.</p>
          )
        },
        {
          id: 'settings-email',
          label: 'Email Delivery',
          defaultCollapsed: true,
          content: settings ? (
            <div className="filters">
              <p className="category-editor-note">
                Google setup: use sender Gmail address + app password. Click
                "Use Gmail defaults", then save.
              </p>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={applyGmailDefaults}>
                  Use Gmail defaults
                </button>
              </div>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={settings.email_reports_enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      email_reports_enabled: e.target.checked
                    })
                  }
                />
                Enable scheduled monthly email
              </label>
              <label>
                Recipient list (comma or newline separated)
                <textarea
                  rows={3}
                  value={reportRecipients}
                  onChange={(e) => {
                    setReportRecipients(e.target.value);
                    setSettings({ ...settings, email_report_recipients: e.target.value });
                  }}
                  placeholder="name1@example.com, name2@example.com"
                />
              </label>
              {recipientList.length > 0 && (
                <div className="accounts-custom-group-list">
                  {recipientList.map((recipient) => (
                    <span key={recipient} className="badge">
                      {recipient}
                    </span>
                  ))}
                </div>
              )}
              <label>
                SMTP host
                <input
                  value={settings.smtp_host}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp_host: e.target.value
                    })
                  }
                />
              </label>
              <label>
                SMTP port
                <input
                  type="number"
                  value={settings.smtp_port}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp_port: Number(e.target.value)
                    })
                  }
                />
              </label>
              <label>
                SMTP username
                <input
                  value={settings.smtp_username}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp_username: e.target.value
                    })
                  }
                />
              </label>
              <label>
                SMTP from address
                <input
                  value={settings.smtp_from}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      smtp_from: e.target.value
                    })
                  }
                />
              </label>
              <label>
                SMTP password / app key
                <input
                  type="password"
                  value={smtpPassword}
                  placeholder={settings.smtp_password_set ? 'Saved (leave empty to keep)' : ''}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                />
              </label>
              <div className="row-actions">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={settings.smtp_use_tls}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        smtp_use_tls: e.target.checked
                      })
                    }
                  />
                  Use TLS
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={settings.smtp_use_ssl}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        smtp_use_ssl: e.target.checked
                      })
                    }
                  />
                  Use SSL
                </label>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  onClick={saveEmailSettings}
                  disabled={savingEmail}
                  className={savingEmail ? 'button-loading' : ''}
                >
                  {savingEmail ? 'Saving...' : 'Save email settings'}
                </button>
              </div>
            </div>
          ) : (
            <p>Settings unavailable.</p>
          )
        },
        {
          id: 'settings-advisor-report',
          label: 'Advisor Report',
          content: (
            <div className="filters">
              <h4>Generate monthly advisor report</h4>
              <div className="grid two">
                <label>
                  Period (days)
                  <input
                    type="number"
                    min={7}
                    max={366}
                    value={reportDays}
                    onChange={(e) => setReportDays(Number(e.target.value))}
                  />
                </label>
                <label>
                  End date
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                  />
                </label>
              </div>
              <div className="row-actions">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={includePending}
                    onChange={(e) => setIncludePending(e.target.checked)}
                  />
                  Include pending
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={includeTransfers}
                    onChange={(e) => setIncludeTransfers(e.target.checked)}
                  />
                  Include transfers
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
              <div className="row-actions">
                <button
                  onClick={generateAdvisorReport}
                  disabled={reportLoading}
                  className={reportLoading ? 'button-loading' : ''}
                >
                  {reportLoading ? 'Generating...' : 'Generate monthly report'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!advisorReport}
                  onClick={() =>
                    advisorReport
                      ? copyText(advisorReport.prompt_markdown).then(() =>
                          setMessage('Prompt copied.')
                        )
                      : null
                  }
                >
                  Copy advisor prompt
                </button>
              </div>
              {advisorReport && (
                <article className="card">
                  <p>
                    Generated period: {advisorReport.start} to {advisorReport.end} (
                    {advisorReport.days} days)
                  </p>
                  <textarea
                    rows={16}
                    readOnly
                    value={advisorReport.prompt_markdown}
                  />
                </article>
              )}
              <label>
                Paste advisor response
                <textarea
                  rows={10}
                  value={advisorResponse}
                  onChange={(e) => setAdvisorResponse(e.target.value)}
                  placeholder="Paste LLM recommendations here..."
                />
              </label>
              <label>
                Send to these addresses
                <textarea
                  rows={3}
                  value={reportRecipients}
                  onChange={(e) => setReportRecipients(e.target.value)}
                  placeholder="owner@example.com, partner@example.com"
                />
              </label>
              {recipientList.length > 0 && (
                <div className="accounts-custom-group-list">
                  {recipientList.map((recipient) => (
                    <span key={`advisor-${recipient}`} className="badge">
                      {recipient}
                    </span>
                  ))}
                </div>
              )}
              <div className="row-actions">
                <button
                  type="button"
                  className={previewLoading ? 'button-loading' : ''}
                  disabled={previewLoading}
                  onClick={previewAdvisorEmail}
                >
                  {previewLoading ? 'Building...' : 'Build email preview'}
                </button>
                <button
                  type="button"
                  className={`secondary ${emailSending ? 'button-loading' : ''}`}
                  disabled={emailSending}
                  onClick={sendAdvisorEmail}
                >
                  {emailSending ? 'Sending...' : 'Send advisor email'}
                </button>
              </div>
              {emailPreview && (
                <article className="card">
                  <h4>{emailPreview.subject}</h4>
                  <p>
                    Recipients: {recipientList.length > 0 ? recipientList.join(', ') : '(none)'}
                  </p>
                  <div className="advisor-email-preview">
                    <iframe
                      title="Advisor email preview"
                      srcDoc={emailPreview.html_body}
                      sandbox=""
                    />
                  </div>
                  <label>
                    Markdown body (copy manually if needed)
                    <textarea rows={14} readOnly value={emailPreview.markdown_body} />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      copyText(emailPreview.markdown_body).then(() =>
                        setMessage('Email markdown copied.')
                      )
                    }
                  >
                    Copy markdown email
                  </button>
                </article>
              )}
            </div>
          )
        },
        {
          id: 'settings-custom-groups',
          label: 'Custom Account Groups',
          defaultCollapsed: true,
          content: (
            <div className="filters">
              <p className="category-editor-note">
                Create custom groups here. They appear in each account card&apos;s Group dropdown.
              </p>
              <div className="accounts-group-create">
                <label>
                  Group name
                  <input
                    value={newGroupName}
                    placeholder="e.g., Bills, Travel, Tax"
                    onChange={(event) => setNewGroupName(event.target.value)}
                  />
                </label>
                <label>
                  Icon
                  <input
                    value={newGroupIcon}
                    placeholder="🏷️"
                    maxLength={2}
                    onChange={(event) => setNewGroupIcon(event.target.value)}
                  />
                </label>
                <button type="button" onClick={createCustomGroup}>
                  Create group
                </button>
              </div>
              {customGroups.length > 0 && (
                <div className="accounts-custom-group-grid">
                  {customGroups.map((group) => (
                    <div key={group.key} className="accounts-custom-group-item">
                      <span>
                        {group.icon ? `${group.icon} ` : ''}
                        {group.label}
                      </span>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => deleteCustomGroup(group.key)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        }
      ]}
    />
  );
}
