import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../api';
import { CategorySelector } from '../components/CategorySelector';
import type {
  Category,
  Rule,
  RuleCreateResponse,
  RulePreviewResponse
} from '../types';
import { buildCategoryPathMap } from '../utils/categories';

export function RulesPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<Rule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({
    priority: 100,
    match_type: 'contains',
    pattern: '',
    category_id: null as number | null
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [appliedInfo, setAppliedInfo] = useState<{
    matchCount: number;
    ids: string[];
  } | null>(null);

  const pathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const hasChildren = useMemo(() => {
    const parentIds = new Set<number>();
    categories.forEach((category) => {
      if (category.parent_id) parentIds.add(category.parent_id);
    });
    return parentIds;
  }, [categories]);

  async function load() {
    const [rulesResp, catsResp] = await Promise.all([
      apiFetch<Rule[]>('/api/rules'),
      apiFetch<Category[]>('/api/categories')
    ]);
    setRules(rulesResp);
    setCategories(catsResp);
  }

  useEffect(() => {
    load().catch(() => {
      setRules([]);
      setCategories([]);
    });
  }, []);

  async function createRule(e: FormEvent) {
    e.preventDefault();
    if (!form.category_id) return;
    setError('');
    setMessage('');
    setAppliedInfo(null);
    try {
      const preview = await apiFetch<RulePreviewResponse>(
        '/api/rules/preview',
        {
          method: 'POST',
          body: JSON.stringify({
            priority: Number(form.priority),
            match_type: form.match_type,
            pattern: form.pattern,
            category_id: form.category_id
          })
        }
      );
      const created = await apiFetch<RuleCreateResponse>('/api/rules', {
        method: 'POST',
        body: JSON.stringify({
          priority: Number(form.priority),
          match_type: form.match_type,
          pattern: form.pattern,
          category_id: form.category_id
        })
      });
      setForm({
        priority: 100,
        match_type: 'contains',
        pattern: '',
        category_id: null
      });
      setMessage(
        `Rule saved. Preview matched ${preview.match_count}; applied to ${created.match_count} transactions.`
      );
      setAppliedInfo({
        matchCount: created.match_count,
        ids: created.sample_transaction_ids
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rule create failed');
    }
  }

  async function deleteRule(id: number) {
    await apiFetch(`/api/rules/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section>
      <h2>Rules</h2>
      <form className="card filters" onSubmit={createRule}>
        <label>
          Priority
          <input
            type="number"
            value={form.priority}
            onChange={(e) =>
              setForm({ ...form, priority: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Match Type
          <select
            value={form.match_type}
            onChange={(e) => setForm({ ...form, match_type: e.target.value })}
          >
            <option value="contains">contains</option>
            <option value="regex">regex</option>
            <option value="merchant">merchant</option>
            <option value="account">account</option>
          </select>
        </label>
        <label>
          Pattern
          <input
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          />
        </label>
        <label>
          Category
          <CategorySelector
            categories={categories}
            value={form.category_id}
            onChange={(category_id) => setForm({ ...form, category_id })}
            noneLabel="Select category"
          />
        </label>
        <button type="submit">Create rule</button>
      </form>

      {form.category_id && (
        <p>
          Selected category path:{' '}
          <strong>{pathMap.get(form.category_id) ?? 'Unknown'}</strong>
          {hasChildren.has(form.category_id) && (
            <span className="category-editor-note">
              {' '}
              (parent selected: this rule will apply broadly unless a child is
              chosen)
            </span>
          )}
        </p>
      )}
      {message && <p className="toast">{message}</p>}
      {error && <p className="error">{error}</p>}
      {appliedInfo && appliedInfo.matchCount > 0 && (
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              navigate(
                `/transactions?ids=${encodeURIComponent(appliedInfo.ids.join(','))}`
              )
            }
          >
            View affected transactions
          </button>
        </p>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Priority</th>
            <th>Type</th>
            <th>Pattern</th>
            <th>Category</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td>{rule.id}</td>
              <td>{rule.priority}</td>
              <td>{rule.match_type}</td>
              <td>{rule.pattern ?? '-'}</td>
              <td>{pathMap.get(rule.category_id) ?? rule.category_id}</td>
              <td>
                <button className="danger" onClick={() => deleteRule(rule.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
