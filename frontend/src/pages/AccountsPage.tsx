import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../api';
import type { Account } from '../types';

const FAVORITES_KEY = 'bt_accounts_favorites_v1';
const ORDER_KEY = 'bt_accounts_order_v1';
const COLLAPSED_KEY = 'bt_accounts_collapsed_types_v1';
const GROUP_ORDER_KEY = 'bt_accounts_group_order_v1';
const GROUP_PREFS_KEY = 'bt_accounts_group_prefs_v1';
const ONLY_FAVORITES_KEY = 'bt_accounts_only_favorites_v1';
const CUSTOM_GROUPS_KEY = 'bt_accounts_custom_groups_v1';
const ACCOUNT_GROUP_ASSIGN_KEY = 'bt_accounts_account_group_assign_v1';

const LIABILITY_TYPES = new Set([
  'credit',
  'credit_card',
  'loan',
  'mortgage',
  'liability',
  'debt'
]);

type GroupPrefs = Record<string, { label: string; icon: string }>;
type CustomGroup = { key: string; label: string; icon: string };

type GroupDef = {
  key: string;
  label: string;
  icon: string;
  kind: 'custom' | 'type';
};

function typeLabel(value: string): string {
  const raw = (value || 'other').trim().toLowerCase();
  if (!raw) return 'Other';
  return raw
    .split(/[_\s-]+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function normalizeType(value: string): string {
  return (value || 'other').trim().toLowerCase() || 'other';
}

function typeGroupKey(value: string): string {
  return `type:${normalizeType(value)}`;
}

function normalizeStoredGroupKey(value: string): string {
  if (!value) return value;
  if (value.includes(':')) return value;
  return `type:${value.trim().toLowerCase()}`;
}

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => normalizeStoredGroupKey(item));
  } catch {
    return [];
  }
}

function parseGroupPrefs(value: string | null): GroupPrefs {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<
      string,
      { label?: unknown; icon?: unknown }
    >;
    const out: GroupPrefs = {};
    for (const [key, pref] of Object.entries(parsed ?? {})) {
      out[normalizeStoredGroupKey(key)] = {
        label: typeof pref.label === 'string' ? pref.label : '',
        icon: typeof pref.icon === 'string' ? pref.icon : ''
      };
    }
    return out;
  } catch {
    return {};
  }
}

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

function parseAssignment(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [accountId, groupKey] of Object.entries(parsed ?? {})) {
      if (typeof accountId !== 'string' || typeof groupKey !== 'string') continue;
      out[accountId] = normalizeStoredGroupKey(groupKey);
    }
    return out;
  } catch {
    return {};
  }
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    parseJsonArray(
      typeof window !== 'undefined' ? window.localStorage.getItem(FAVORITES_KEY) : null
    )
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    parseJsonArray(typeof window !== 'undefined' ? window.localStorage.getItem(ORDER_KEY) : null)
  );
  const [collapsedTypes, setCollapsedTypes] = useState<string[]>(() =>
    parseJsonArray(
      typeof window !== 'undefined' ? window.localStorage.getItem(COLLAPSED_KEY) : null
    )
  );
  const [groupOrder, setGroupOrder] = useState<string[]>(() =>
    parseJsonArray(
      typeof window !== 'undefined' ? window.localStorage.getItem(GROUP_ORDER_KEY) : null
    )
  );
  const [groupPrefs, setGroupPrefs] = useState<GroupPrefs>(() =>
    parseGroupPrefs(
      typeof window !== 'undefined' ? window.localStorage.getItem(GROUP_PREFS_KEY) : null
    )
  );
  const [onlyFavorites, setOnlyFavorites] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.localStorage.getItem(ONLY_FAVORITES_KEY) === '1'
  );
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(() =>
    parseCustomGroups(
      typeof window !== 'undefined' ? window.localStorage.getItem(CUSTOM_GROUPS_KEY) : null
    )
  );
  const [accountGroupAssign, setAccountGroupAssign] = useState<Record<string, string>>(() =>
    parseAssignment(
      typeof window !== 'undefined'
        ? window.localStorage.getItem(ACCOUNT_GROUP_ASSIGN_KEY)
        : null
    )
  );

  useEffect(() => {
    apiFetch<Account[]>('/api/accounts')
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(orderedIds));
  }, [orderedIds]);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedTypes));
  }, [collapsedTypes]);

  useEffect(() => {
    window.localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));
  }, [groupOrder]);

  useEffect(() => {
    window.localStorage.setItem(GROUP_PREFS_KEY, JSON.stringify(groupPrefs));
  }, [groupPrefs]);

  useEffect(() => {
    window.localStorage.setItem(ONLY_FAVORITES_KEY, onlyFavorites ? '1' : '0');
  }, [onlyFavorites]);

  useEffect(() => {
    window.localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(customGroups));
  }, [customGroups]);

  useEffect(() => {
    window.localStorage.setItem(ACCOUNT_GROUP_ASSIGN_KEY, JSON.stringify(accountGroupAssign));
  }, [accountGroupAssign]);

  const orderMap = useMemo(() => {
    const map = new Map<string, number>();
    orderedIds.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [orderedIds]);

  const visibleOrderIds = useMemo(() => {
    const ids = new Set(accounts.map((account) => account.id));
    return orderedIds.filter((id) => ids.has(id));
  }, [accounts, orderedIds]);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const aOrder = orderMap.get(a.id);
      const bOrder = orderMap.get(b.id);
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, orderMap]);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const favorites = useMemo(
    () => sortedAccounts.filter((account) => favoriteSet.has(account.id)),
    [sortedAccounts, favoriteSet]
  );

  const typeDefs = useMemo(() => {
    const map = new Map<string, GroupDef>();
    for (const account of sortedAccounts) {
      const normalizedType = normalizeType(account.type);
      const key = typeGroupKey(normalizedType);
      if (map.has(key)) continue;
      map.set(key, {
        key,
        label: typeLabel(normalizedType),
        icon: '',
        kind: 'type'
      });
    }
    return Array.from(map.values());
  }, [sortedAccounts]);

  const customDefs = useMemo<GroupDef[]>(
    () =>
      customGroups.map((group) => ({
        key: group.key,
        label: group.label,
        icon: group.icon,
        kind: 'custom'
      })),
    [customGroups]
  );

  const allGroupDefs = useMemo(() => [...customDefs, ...typeDefs], [customDefs, typeDefs]);

  const defsByKey = useMemo(() => {
    const map = new Map<string, GroupDef>();
    allGroupDefs.forEach((def) => map.set(def.key, def));
    return map;
  }, [allGroupDefs]);

  const visibleAccounts = useMemo(
    () =>
      onlyFavorites
        ? sortedAccounts.filter((account) => favoriteSet.has(account.id))
        : sortedAccounts,
    [sortedAccounts, onlyFavorites, favoriteSet]
  );

  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        icon: string;
        kind: 'custom' | 'type';
        items: Account[];
        total: number;
        available: number;
        net: number;
      }
    >();

    for (const account of visibleAccounts) {
      const defaultKey = typeGroupKey(account.type);
      const assignedKey = accountGroupAssign[account.id];
      const key = assignedKey && defsByKey.has(assignedKey) ? assignedKey : defaultKey;
      const def = defsByKey.get(key) ?? {
        key,
        label: typeLabel(account.type),
        icon: '',
        kind: 'type' as const
      };
      const pref = groupPrefs[key];

      if (!map.has(key)) {
        map.set(key, {
          key,
          label: pref?.label?.trim() ? pref.label.trim() : def.label,
          icon: pref?.icon?.trim() ? pref.icon.trim() : def.icon,
          kind: def.kind,
          items: [],
          total: 0,
          available: 0,
          net: 0
        });
      }
      const group = map.get(key)!;
      group.items.push(account);
      const balance = Number(account.balance ?? 0);
      const available = Number(account.available_balance ?? 0);
      const isLiability = LIABILITY_TYPES.has(normalizeType(account.type));
      const signed = isLiability ? -Math.abs(balance) : balance;
      group.total += balance;
      group.available += available;
      group.net += signed;
    }

    const groupOrderMap = new Map<string, number>();
    groupOrder.forEach((key, idx) => groupOrderMap.set(key, idx));
    return Array.from(map.values()).sort((a, b) => {
      const aOrder = groupOrderMap.get(a.key);
      const bOrder = groupOrderMap.get(b.key);
      if (aOrder != null && bOrder != null) return aOrder - bOrder;
      if (aOrder != null) return -1;
      if (bOrder != null) return 1;
      return Math.abs(b.net) - Math.abs(a.net);
    });
  }, [visibleAccounts, accountGroupAssign, defsByKey, groupPrefs, groupOrder]);

  const totals = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const account of sortedAccounts) {
      const balance = Number(account.balance ?? 0);
      if (LIABILITY_TYPES.has(normalizeType(account.type))) liabilities += Math.abs(balance);
      else assets += Math.max(0, balance);
    }
    return { assets, liabilities, net: assets - liabilities };
  }, [sortedAccounts]);

  function toggleFavorite(accountId: string) {
    setFavoriteIds((prev) => {
      if (prev.includes(accountId)) return prev.filter((id) => id !== accountId);
      return [accountId, ...prev];
    });
  }

  function toggleCollapsed(typeKey: string) {
    setCollapsedTypes((prev) =>
      prev.includes(typeKey)
        ? prev.filter((item) => item !== typeKey)
        : [...prev, typeKey]
    );
  }

  function moveAccount(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const base = visibleOrderIds.length
      ? visibleOrderIds
      : sortedAccounts.map((account) => account.id);
    const next = [...base];
    const fromIndex = next.indexOf(sourceId);
    const toIndex = next.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, sourceId);
    setOrderedIds(next);
  }

  function moveGroup(typeKey: string, direction: -1 | 1) {
    const currentKeys = grouped.map((group) => group.key);
    const base = groupOrder
      .filter((key) => currentKeys.includes(key))
      .concat(currentKeys.filter((key) => !groupOrder.includes(key)));
    const from = base.indexOf(typeKey);
    if (from < 0) return;
    const to = from + direction;
    if (to < 0 || to >= base.length) return;
    const next = [...base];
    next.splice(from, 1);
    next.splice(to, 0, typeKey);
    setGroupOrder(next);
  }

  function setGroupPref(typeKey: string, patch: Partial<{ label: string; icon: string }>) {
    setGroupPrefs((prev) => ({
      ...prev,
      [typeKey]: {
        label: patch.label ?? prev[typeKey]?.label ?? '',
        icon: patch.icon ?? prev[typeKey]?.icon ?? ''
      }
    }));
  }

  function deleteCustomGroup(groupKey: string) {
    setCustomGroups((prev) => prev.filter((group) => group.key !== groupKey));
    setGroupOrder((prev) => prev.filter((key) => key !== groupKey));
    setCollapsedTypes((prev) => prev.filter((key) => key !== groupKey));
    setGroupPrefs((prev) => {
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setAccountGroupAssign((prev) => {
      const next: Record<string, string> = {};
      for (const [accountId, key] of Object.entries(prev)) {
        if (key !== groupKey) next[accountId] = key;
      }
      return next;
    });
    setEditingGroupKey((prev) => (prev === groupKey ? null : prev));
  }

  function setAccountGroup(accountId: string, nextGroupKey: string, accountType: string) {
    const fallback = typeGroupKey(accountType);
    const next = normalizeStoredGroupKey(nextGroupKey);
    setAccountGroupAssign((prev) => {
      if (next === fallback) {
        const copy = { ...prev };
        delete copy[accountId];
        return copy;
      }
      return { ...prev, [accountId]: next };
    });
  }

  function effectiveGroupKey(account: Account): string {
    const fallback = typeGroupKey(account.type);
    const assigned = accountGroupAssign[account.id];
    if (!assigned) return fallback;
    return defsByKey.has(assigned) ? assigned : fallback;
  }

  function renderAccountCard(acct: Account) {
    return (
      <article
        key={acct.id}
        className={`accounts-card ${draggingId === acct.id ? 'dragging' : ''}`}
        draggable
        onDragStart={() => setDraggingId(acct.id)}
        onDragEnd={() => setDraggingId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (!draggingId) return;
          moveAccount(draggingId, acct.id);
          setDraggingId(null);
        }}
      >
        <div className="accounts-card-head">
          <strong>{acct.name}</strong>
          <button
            type="button"
            className="secondary"
            title={favoriteSet.has(acct.id) ? 'Unfavorite' : 'Favorite'}
            onClick={() => toggleFavorite(acct.id)}
          >
            {favoriteSet.has(acct.id) ? '★' : '☆'}
          </button>
        </div>
        <p>{acct.institution_name ?? 'Unknown institution'}</p>
        <label>
          Group
          <select
            value={effectiveGroupKey(acct)}
            onChange={(event) => setAccountGroup(acct.id, event.target.value, acct.type)}
          >
            {allGroupDefs.map((group) => (
              <option key={group.key} value={group.key}>
                {(group.icon ? `${group.icon} ` : '') + group.label}
              </option>
            ))}
          </select>
        </label>
        <p>Balance: {money(acct.balance)}</p>
        <p>Available: {money(acct.available_balance)}</p>
        <small>
          Last sync: {acct.last_sync_at ? new Date(acct.last_sync_at).toLocaleString() : '-'}
        </small>
      </article>
    );
  }

  return (
    <section className="accounts-dashboard">
      <h2>Accounts</h2>
      <div className="accounts-topline">
        <article className="card">
          <h3>Total Assets</h3>
          <p className="big">{money(totals.assets)}</p>
        </article>
        <article className="card">
          <h3>Total Liabilities</h3>
          <p className="big">{money(totals.liabilities)}</p>
        </article>
        <article className="card">
          <h3>Net Position</h3>
          <p className={`big ${totals.net >= 0 ? 'positive' : 'negative'}`}>
            {money(totals.net)}
          </p>
        </article>
      </div>

      <p className="accounts-help">
        Drag cards to rearrange order, favorite key accounts, and assign groups from each account card.
      </p>
      <div className="row-actions">
        <button
          type="button"
          className={onlyFavorites ? '' : 'secondary'}
          onClick={() => setOnlyFavorites((prev) => !prev)}
        >
          {onlyFavorites ? 'Only favorites: ON' : 'Only favorites: OFF'}
        </button>
      </div>

      {!onlyFavorites && favorites.length > 0 && (
        <section className="accounts-group">
          <header className="accounts-group-head">
            <h3>Favorites</h3>
            <small>{favorites.length} accounts</small>
          </header>
          <div className="accounts-card-grid">{favorites.map(renderAccountCard)}</div>
        </section>
      )}

      {grouped.map((group) => {
        const collapsed = collapsedTypes.includes(group.key);
        const pref = groupPrefs[group.key] ?? { label: '', icon: '' };
        return (
          <section key={group.key} className="accounts-group">
            <header className="accounts-group-head">
              <h3>
                {group.icon ? `${group.icon} ` : ''}
                {group.label}
              </h3>
              <div className="accounts-group-meta">
                <span>{group.items.length} accounts</span>
                <span>Total: {money(group.total)}</span>
                <span>Available: {money(group.available)}</span>
                <span className={group.net >= 0 ? 'positive' : 'negative'}>
                  Net: {money(group.net)}
                </span>
                <button
                  type="button"
                  className="secondary"
                  title="Move group up"
                  onClick={() => moveGroup(group.key, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="secondary"
                  title="Move group down"
                  onClick={() => moveGroup(group.key, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setEditingGroupKey((prev) => (prev === group.key ? null : group.key))
                  }
                >
                  {editingGroupKey === group.key ? 'Done' : 'Customize'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => toggleCollapsed(group.key)}
                >
                  {collapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>
            </header>
            {editingGroupKey === group.key && (
              <div className="accounts-group-customize">
                <label>
                  Group name
                  <input
                    value={pref.label}
                    placeholder={group.label}
                    onChange={(event) =>
                      setGroupPref(group.key, { label: event.target.value })
                    }
                  />
                </label>
                <label>
                  Icon
                  <input
                    value={pref.icon}
                    maxLength={2}
                    placeholder="🏦"
                    onChange={(event) =>
                      setGroupPref(group.key, { icon: event.target.value })
                    }
                  />
                </label>
                {group.kind === 'custom' && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => deleteCustomGroup(group.key)}
                  >
                    Delete group
                  </button>
                )}
              </div>
            )}
            {!collapsed && (
              <div className="accounts-card-grid">{group.items.map(renderAccountCard)}</div>
            )}
          </section>
        );
      })}
    </section>
  );
}
