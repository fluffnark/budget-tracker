import type { Category } from '../types';

type ResolvedCategory = {
  path: string;
  family: string;
  spendBucket: string | null;
  color: string | null;
  isTopLevel: boolean;
};

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function rootPath(categoryId: number, byId: Map<number, Category>, cache: Map<number, string>): string {
  const cached = cache.get(categoryId);
  if (cached) return cached;
  const category = byId.get(categoryId);
  if (!category) return '';
  if (category.parent_id == null) {
    cache.set(categoryId, category.name);
    return category.name;
  }
  const parent = rootPath(category.parent_id, byId, cache);
  const path = parent ? `${parent} > ${category.name}` : category.name;
  cache.set(categoryId, path);
  return path;
}

function bucketBaseHue(bucket: string | null): number {
  switch (bucket) {
    case 'essential':
      return 205;
    case 'discretionary':
      return 28;
    case 'savings':
      return 155;
    case 'debt':
      return 355;
    case 'income':
      return 170;
    case 'transfer':
      return 220;
    case 'uncategorized':
      return 215;
    default:
      return 245;
  }
}

function heuristicColor(entry: ResolvedCategory): string {
  const familyHash = hashString(entry.family || entry.path || 'category');
  const pathHash = hashString(entry.path || entry.family || 'category');
  const baseHue = (bucketBaseHue(entry.spendBucket) + (familyHash % 46) - 23 + 360) % 360;
  const variant = pathHash % 5;
  const saturation = 58 + (pathHash % 10);
  const lightness = 44 + variant * 6;
  return hsl(baseHue, saturation, Math.min(lightness, 68));
}

export function buildCategoryColorResolver(categories: Category[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const pathCache = new Map<number, string>();
  const resolved = new Map<string, ResolvedCategory>();
  const uniqueNameCounts = new Map<string, number>();

  for (const category of categories) {
    uniqueNameCounts.set(category.name, (uniqueNameCounts.get(category.name) ?? 0) + 1);
  }

  for (const category of categories) {
    const path = rootPath(category.id, byId, pathCache) || category.name;
    const family = path.split(' > ')[0] ?? category.name;
    const entry: ResolvedCategory = {
      path,
      family,
      spendBucket: category.spend_bucket,
      color: category.color,
      isTopLevel: category.parent_id == null
    };
    resolved.set(path, entry);
    if ((uniqueNameCounts.get(category.name) ?? 0) === 1) {
      resolved.set(category.name, entry);
    }
  }

  return (label: string, _index?: number): string => {
    if (label === 'Other') return 'var(--text-subtle)';
    const match = resolved.get(label);
    if (match?.color && match.isTopLevel) return match.color;
    if (match) return heuristicColor(match);

    const path = label.split(' > ');
    const family = path[0] ?? label;
    return heuristicColor({
      path: label,
      family,
      spendBucket: null,
      color: null,
      isTopLevel: false
    });
  };
}
