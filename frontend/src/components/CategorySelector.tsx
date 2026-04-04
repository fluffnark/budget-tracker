import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Category } from '../types';
import {
  buildCategoryPathMap,
  buildCategoryTree,
  type CategoryNode
} from '../utils/categories';

type Props = {
  categories: Category[];
  value: number | null;
  onChange: (next: number | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  disabledIds?: Set<number>;
  showSearch?: boolean;
};

type MenuStyle = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
};

export function CategorySelector({
  categories,
  value,
  onChange,
  allowNone = true,
  noneLabel = 'Uncategorized',
  disabledIds,
  showSearch = false
}: Props) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const pathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const byId = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const selected = value ? byId.get(value) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const gap = 6;
      const estimatedHeight = 320;
      const spaceBelow = viewportHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        180,
        Math.min(estimatedHeight, openUpward ? spaceAbove : spaceBelow)
      );
      const width = Math.max(rect.width, Math.min(360, viewportWidth - 16));
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const top = openUpward
        ? Math.max(8, rect.top - maxHeight - gap)
        : Math.min(viewportHeight - 8 - maxHeight, rect.bottom + gap);
      setMenuStyle({ top, left, width, maxHeight, openUpward });
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const insideTrigger = !!target && !!rootRef.current?.contains(target);
      const insideMenu = !!target && !!menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) {
        setOpen(false);
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setExpandedIds(new Set());
      return;
    }
    if (!value) return;
    const next = new Set<number>();
    let current = byId.get(value) ?? null;
    while (current?.parent_id) {
      next.add(current.parent_id);
      current = byId.get(current.parent_id) ?? null;
    }
    setExpandedIds(next);
  }, [byId, open, value]);

  function toggleExpanded(categoryId: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  return (
    <div className="category-select" ref={rootRef} data-show-search={showSearch}>
      <button
        type="button"
        className="category-select-trigger"
        ref={triggerRef}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="category-select-trigger-value">
          {selected?.icon ? `${selected.icon} ` : ''}
          {selected ? pathMap.get(selected.id) ?? selected.name : noneLabel}
        </span>
        <span className="category-select-trigger-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open &&
        menuStyle &&
        createPortal(
          <div
            className={`category-select-menu ${menuStyle.openUpward ? 'open-upward' : ''}`}
            ref={menuRef}
            style={{
              position: 'fixed',
              top: menuStyle.top,
              left: menuStyle.left,
              width: menuStyle.width,
              maxWidth: 'calc(100vw - 16px)'
            }}
          >
            <div
              className="category-select-menu-scroll"
              style={{ maxHeight: menuStyle.maxHeight }}
            >
              {allowNone && (
                <button
                  type="button"
                  className={`category-select-option ${value === null ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <span className="category-select-option-label">{noneLabel}</span>
                </button>
              )}

              <CategoryTree
                nodes={tree}
                depth={0}
                selectedId={value}
                disabledIds={disabledIds}
                expandedIds={expandedIds}
                onToggleExpanded={toggleExpanded}
                onPick={(next) => {
                  onChange(next);
                  setOpen(false);
                }}
              />
            </div>
          </div>,
          document.body
        )}

      {value && <small>{pathMap.get(value) ?? ''}</small>}
    </div>
  );
}

type CategoryTreeProps = {
  nodes: CategoryNode[];
  depth: number;
  selectedId: number | null;
  disabledIds?: Set<number>;
  expandedIds: Set<number>;
  onToggleExpanded: (categoryId: number) => void;
  onPick: (next: number | null) => void;
};

function CategoryTree({
  nodes,
  depth,
  selectedId,
  disabledIds,
  expandedIds,
  onToggleExpanded,
  onPick
}: CategoryTreeProps) {
  return (
    <div className="category-select-tree">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const expanded = expandedIds.has(node.category.id);
        const disabled = disabledIds?.has(node.category.id) ?? false;
        return (
          <div key={node.category.id} className="category-select-node">
            <div
              className={`category-select-row ${expanded ? 'expanded' : ''}`}
              style={{ paddingLeft: `${depth * 14}px` }}
            >
              <button
                type="button"
                className={`category-select-option ${
                  selectedId === node.category.id ? 'selected' : ''
                }`}
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onPick(node.category.id);
                }}
              >
                <span className="category-select-option-label">
                  {node.category.icon ? `${node.category.icon} ` : ''}
                  {node.category.name}
                </span>
              </button>
              {hasChildren && (
                <button
                  type="button"
                  className="category-select-expand"
                  aria-label={expanded ? 'Collapse subcategories' : 'Expand subcategories'}
                  onClick={() => onToggleExpanded(node.category.id)}
                >
                  {expanded ? '▾' : '▸'}
                </button>
              )}
            </div>

            {hasChildren && expanded && (
              <CategoryTree
                nodes={node.children}
                depth={depth + 1}
                selectedId={selectedId}
                disabledIds={disabledIds}
                expandedIds={expandedIds}
                onToggleExpanded={onToggleExpanded}
                onPick={onPick}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
