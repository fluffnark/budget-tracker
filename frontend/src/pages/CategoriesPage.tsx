import { FormEvent, useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../api';
import { CategorySelector } from '../components/CategorySelector';
import { SectionLayout } from '../components/SectionLayout';
import type { Category } from '../types';
import {
  buildCategoryPathMap,
  buildCategoryTree,
  collectDescendantIds
} from '../utils/categories';
import { resolveThemeHex } from '../utils/theme';

type CategoryDraft = {
  name: string;
  system_kind: string;
  parent_id: number | null;
  color: string;
  icon: string;
};

const SYSTEM_KINDS = ['expense', 'income', 'transfer', 'uncategorized'];
const DEFAULT_CATEGORY_COLOR = resolveThemeHex('--accent-clay');

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CategoryDraft>({
    name: '',
    system_kind: 'expense',
    parent_id: null,
    color: DEFAULT_CATEGORY_COLOR,
    icon: '🏷️'
  });
  const [draft, setDraft] = useState<CategoryDraft | null>(null);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const pathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const editingCategory = useMemo(
    () => categories.find((category) => category.id === editingId) ?? null,
    [categories, editingId]
  );
  const blockedParentIds = useMemo(() => {
    if (!editingCategory) return new Set<number>();
    const ids = collectDescendantIds(categories, editingCategory.id);
    ids.add(editingCategory.id);
    return ids;
  }, [categories, editingCategory]);

  async function load() {
    const rows = await apiFetch<Category[]>('/api/categories');
    setCategories(rows);
    setExpanded(new Set());
  }

  useEffect(() => {
    load().catch(() => {
      setCategories([]);
      setError('Failed to load categories');
    });
  }, []);

  function beginEdit(category: Category) {
    setEditingId(category.id);
    setDraft({
      name: category.name,
      system_kind: category.system_kind,
      parent_id: category.parent_id ?? null,
      color: category.color ?? DEFAULT_CATEGORY_COLOR,
      icon: category.icon ?? ''
    });
  }

  function toggleExpand(categoryId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      setError('');
      await apiFetch('/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          system_kind: form.system_kind,
          parent_id: form.parent_id,
          color: form.color || null,
          icon: form.icon || null
        })
      });
      setMessage('Category created');
      setForm({
        name: '',
        system_kind: 'expense',
        parent_id: null,
        color: DEFAULT_CATEGORY_COLOR,
        icon: '🏷️'
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function saveEdit() {
    if (!editingId || !draft) return;
    try {
      setError('');
      await apiFetch(`/api/categories/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name.trim(),
          system_kind: draft.system_kind,
          parent_id: draft.parent_id,
          color: draft.color || null,
          icon: draft.icon || null
        })
      });
      setMessage('Category saved');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function removeCategory(id: number) {
    try {
      setError('');
      await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
      if (editingId === id) {
        setEditingId(null);
        setDraft(null);
      }
      setMessage('Category deleted');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <SectionLayout
      pageKey="categories"
      title="Categories"
      intro={
        <>
          {message && <p className="toast">{message}</p>}
          {error && <p className="error">{error}</p>}
        </>
      }
      sections={[
        {
          id: 'categories-create',
          label: 'Create Category',
          content: (
            <form className="filters" onSubmit={createCategory}>
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Housing/Utilities"
                />
              </label>
              <label>
                Kind
                <select
                  value={form.system_kind}
                  onChange={(e) =>
                    setForm({ ...form, system_kind: e.target.value })
                  }
                >
                  {SYSTEM_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Parent
                <CategorySelector
                  categories={categories}
                  value={form.parent_id}
                  onChange={(parent_id) => setForm({ ...form, parent_id })}
                  noneLabel="Top-level"
                />
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </label>
              <label>
                Icon
                <input
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="emoji or short text"
                />
              </label>
              <button type="submit">Add category</button>
            </form>
          )
        },
        {
          id: 'categories-tree',
          label: 'Category Tree',
          content: (
            <CategoryTree
              categories={tree}
              expanded={expanded}
              onToggle={toggleExpand}
              onEdit={beginEdit}
              onDelete={removeCategory}
            />
          )
        },
        {
          id: 'categories-edit',
          label: 'Edit Category',
          defaultCollapsed: true,
          content:
            editingCategory && draft ? (
              <>
                <p>
                  Breadcrumb: <strong>{pathMap.get(editingCategory.id)}</strong>
                </p>
                <div className="filters">
                  <label>
                    Name
                    <input
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Kind
                    <select
                      value={draft.system_kind}
                      onChange={(e) =>
                        setDraft({ ...draft, system_kind: e.target.value })
                      }
                    >
                      {SYSTEM_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Parent
                    <CategorySelector
                      categories={categories}
                      value={draft.parent_id}
                      onChange={(parent_id) =>
                        setDraft({ ...draft, parent_id })
                      }
                      noneLabel="Top-level"
                      disabledIds={blockedParentIds}
                    />
                  </label>
                  <label>
                    Color
                    <input
                      type="color"
                      value={draft.color}
                      onChange={(e) =>
                        setDraft({ ...draft, color: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Icon
                    <input
                      value={draft.icon}
                      onChange={(e) =>
                        setDraft({ ...draft, icon: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={saveEdit}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEditingId(null);
                      setDraft(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p className="category-editor-note">
                Select a category from the tree to edit.
              </p>
            )
        }
      ]}
    />
  );
}

function CategoryTree({
  categories,
  expanded,
  onToggle,
  onEdit,
  onDelete
}: {
  categories: ReturnType<typeof buildCategoryTree>;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onEdit: (category: Category) => void;
  onDelete: (id: number) => void;
}) {
  if (!categories.length) {
    return <p>No categories yet.</p>;
  }

  return (
    <ul className="category-tree">
      {categories.map((node) => {
        const hasChildren = node.children.length > 0;
        const isOpen = expanded.has(node.category.id);
        return (
          <li key={node.category.id}>
            <div className="category-node">
              <button
                type="button"
                className="secondary"
                onClick={() => hasChildren && onToggle(node.category.id)}
                aria-label={hasChildren ? 'Toggle children' : 'No children'}
              >
                {hasChildren ? (isOpen ? '−' : '+') : '•'}
              </button>
              <span
                className="category-swatch"
                style={{
                  backgroundColor: node.category.color ?? 'var(--series-2)'
                }}
              />
              <span>{node.category.icon ? `${node.category.icon} ` : ''}</span>
              <strong>{node.category.name}</strong>
              <span className="badge">{node.category.system_kind}</span>
              <div className="row-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onEdit(node.category)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onDelete(node.category.id)}
                >
                  Delete
                </button>
              </div>
            </div>
            {hasChildren && isOpen && (
              <CategoryTree
                categories={node.children}
                expanded={expanded}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
