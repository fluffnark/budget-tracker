import { useMemo, useState } from 'react';

import type { Category } from '../types';
import {
  buildCategoryPathMap,
  flattenCategoryOptions
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

export function CategorySelector({
  categories,
  value,
  onChange,
  allowNone = true,
  noneLabel = 'Uncategorized',
  disabledIds,
  showSearch = true
}: Props) {
  const [query, setQuery] = useState('');
  const options = useMemo(
    () => flattenCategoryOptions(categories),
    [categories]
  );
  const pathMap = useMemo(() => buildCategoryPathMap(categories), [categories]);
  const filtered = useMemo(() => {
    const token = query.trim().toLowerCase();
    if (!token) return options;
    return options.filter(
      (option) =>
        option.path.toLowerCase().includes(token) ||
        option.name.toLowerCase().includes(token)
    );
  }, [options, query]);

  return (
    <div>
      {showSearch && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search category"
        />
      )}
      <select
        value={value ?? ''}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
      >
        {allowNone && <option value="">{noneLabel}</option>}
        {filtered.map((option) => (
          <option
            key={option.id}
            value={option.id}
            disabled={disabledIds?.has(option.id)}
          >
            {option.label}
          </option>
        ))}
      </select>
      {value && <small>{pathMap.get(value) ?? ''}</small>}
    </div>
  );
}
