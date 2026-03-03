import type { Category } from '../types';

export type CategoryNode = {
  category: Category;
  children: CategoryNode[];
};

export type CategoryOption = {
  id: number;
  name: string;
  depth: number;
  path: string;
  label: string;
};

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const walk = (parentId: number | null): CategoryNode[] =>
    (byParent.get(parentId) ?? []).map((category) => ({
      category,
      children: walk(category.id)
    }));

  return walk(null);
}

export function buildCategoryPathMap(
  categories: Category[]
): Map<number, string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const cache = new Map<number, string>();

  const walk = (id: number, seen = new Set<number>()): string => {
    const cached = cache.get(id);
    if (cached) return cached;
    const current = byId.get(id);
    if (!current) return '';
    if (!current.parent_id) {
      cache.set(id, current.name);
      return current.name;
    }
    if (seen.has(id)) {
      cache.set(id, current.name);
      return current.name;
    }
    seen.add(id);
    const parent = walk(current.parent_id, seen);
    const path = parent ? `${parent} > ${current.name}` : current.name;
    cache.set(id, path);
    return path;
  };

  for (const category of categories) {
    walk(category.id);
  }
  return cache;
}

export function flattenCategoryOptions(
  categories: Category[]
): CategoryOption[] {
  const tree = buildCategoryTree(categories);
  const pathMap = buildCategoryPathMap(categories);
  const out: CategoryOption[] = [];

  const walk = (nodes: CategoryNode[], depth: number) => {
    for (const node of nodes) {
      const path = pathMap.get(node.category.id) ?? node.category.name;
      out.push({
        id: node.category.id,
        name: node.category.name,
        depth,
        path,
        label: `${'  '.repeat(depth)}${path}`
      });
      walk(node.children, depth + 1);
    }
  };

  walk(tree, 0);
  return out;
}

export function collectDescendantIds(
  categories: Category[],
  rootId: number
): Set<number> {
  const byParent = new Map<number | null, number[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category.id);
    byParent.set(category.parent_id, list);
  }
  const out = new Set<number>();
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return out;
}
