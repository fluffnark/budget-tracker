import { useEffect, useState } from 'react';

import { apiFetch } from '../api';
import { SectionLayout } from '../components/SectionLayout';
import { applyThemeMode, readThemeMode, type ThemeMode } from '../themeMode';
import type { Settings, SyncStatus } from '../types';

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [message, setMessage] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [claiming, setClaiming] = useState(false);
  const [syncing, setSyncing] = useState<null | 'sync' | 'backfill'>(null);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  async function load() {
    const s = await apiFetch<Settings>('/api/settings');
    setSettings(s);
  }

  useEffect(() => {
    load().catch(() => setSettings(null));
    setThemeMode(readThemeMode());
    apiFetch<SyncStatus>('/api/sync/status').then(setSyncStatus).catch(() => null);
  }, []);

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

  const backfillProgressPct = Math.round((syncStatus?.progress ?? 0) * 100);
  const isBackfillActive =
    syncing === 'backfill' || (syncStatus?.running && syncStatus.mode === 'backfill');

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

  return (
    <SectionLayout
      pageKey="settings"
      title="Settings"
      intro={message ? <p className="toast">{message}</p> : undefined}
      sections={[
        {
          id: 'settings-connection',
          label: 'Connection',
          content: (
            <div className="filters">
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
                title="Exchange setup token for a saved SimpleFIN access URL"
              >
                {claiming ? 'Claiming...' : 'Claim token'}
              </button>
              <button
                className={`secondary ${syncing === 'sync' ? 'button-loading' : ''}`}
                onClick={() => runSync(false)}
                disabled={syncing !== null}
                title="Sync recent changes (incremental, with overlap for edits and pending-to-posted updates)"
              >
                {syncing === 'sync' ? 'Syncing...' : 'Sync now'}
              </button>
              <button
                className={`secondary ${
                  syncing === 'backfill' ? 'button-loading' : ''
                }`}
                onClick={() => runSync(true)}
                disabled={syncing !== null}
                title="Fetch older historical windows beyond recent sync range (slower, quota-aware)"
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
                title="Save sync schedule and default export preferences"
              >
                {saving ? 'Saving...' : 'Save schedule'}
              </button>
            </div>
          ) : (
            <p>Settings unavailable.</p>
          )
        }
      ]}
    />
  );
}
