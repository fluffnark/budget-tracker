import { useEffect, useMemo, useRef, useState } from 'react';

import type { Category } from '../types';
import { buildCategoryPathMap, buildCategoryTree } from '../utils/categories';

type Props = {
  categories: Category[];
  value: number | null;
  onChange: (next: number | null) => void;
  noneLabel?: string;
};

export function CategoryTreeDropdown({
  categories,
  value,
  onChange,
  noneLabel = 'Uncategorized'
}: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const byId = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const pathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const selected = value ? byId.get(value) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function toggleExpanded(categoryId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function openMenu() {
    setExpanded(new Set());
    setOpen(true);
  }

  return (
    <div className="category-tree-dropdown" ref={rootRef}>
      <button
        type="button"
        className="category-tree-trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="category-tree-trigger-value">
          {selected?.icon ? `${selected.icon} ` : ''}
          {selected ? pathMap.get(selected.id) ?? selected.name : noneLabel}
        </span>
        <span className="category-tree-trigger-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="category-tree-menu">
          <button
            type="button"
            className={`category-tree-option ${value === null ? 'selected' : ''}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span className="category-tree-option-icon">∅</span>
            <span>{noneLabel}</span>
          </button>

          {tree.map((node) => (
            <TreeNode
              key={node.category.id}
              node={node}
              depth={0}
              selectedId={value}
              expanded={expanded}
              onToggle={toggleExpanded}
              onPick={(categoryId) => {
                onChange(categoryId);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TreeNodeProps = {
  node: ReturnType<typeof buildCategoryTree>[number];
  depth: number;
  selectedId: number | null;
  expanded: Set<number>;
  onToggle: (categoryId: number) => void;
  onPick: (categoryId: number) => void;
};

function TreeNode({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onPick
}: TreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.category.id);

  return (
    <div className="category-tree-node">
      <div style={{ paddingLeft: `${depth * 16 + 4}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="category-tree-folder-toggle"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle(node.category.id);
            }}
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="category-tree-folder-spacer"> </span>
        )}

        <button
          type="button"
          className={`category-tree-option ${
            selectedId === node.category.id ? 'selected' : ''
          }`}
          onClick={() => onPick(node.category.id)}
        >
          <span className="category-tree-option-icon">
            {node.category.icon || '🏷️'}
          </span>
          <span>{node.category.name}</span>
        </button>
      </div>

      {hasChildren &&
        isExpanded &&
        (
          <div className="category-tree-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.category.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                expanded={expanded}
                onToggle={onToggle}
                onPick={onPick}
              />
            ))}
          </div>
        )}
    </div>
  );
}
