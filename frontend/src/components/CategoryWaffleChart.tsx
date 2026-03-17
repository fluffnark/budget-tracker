import { useState } from 'react';

type CategoryWaffleItem = {
  category: string;
  amount: number;
};

type CategoryWaffleChartProps = {
  items: CategoryWaffleItem[];
  paletteKey?: string;
  maxLegendItems?: number;
  caption?: string;
  onLegendClick?: (category: string) => void;
  compact?: boolean;
};

type WaffleCell = {
  id: string;
  category: string;
  color: string;
  amount: number;
  percent: number;
};

type WaffleLegendItem = {
  category: string;
  amount: number;
  percent: number;
  cells: number;
  color: string;
};

function categoryColor(category: string, index: number): string {
  const palette = [
    '#5b8ff9',
    '#f6a35b',
    '#5ad8a6',
    '#e8684a',
    '#6dc8ec',
    '#9270ca',
    '#ff9d4d',
    '#269a99',
    '#c2c8d5',
    '#7f8cff'
  ];
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  const palettePick = palette[hash % palette.length];
  if (index < palette.length * 2) return palettePick;
  const hue = hash % 360;
  return `hsl(${hue} 62% 52%)`;
}

function buildWaffle(items: CategoryWaffleItem[], maxLegendItems: number) {
  const source = [...items]
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = source.reduce((sum, item) => sum + item.amount, 0);

  if (!source.length || total <= 0) {
    return { cells: [] as WaffleCell[], legend: [] as WaffleLegendItem[], total: 0 };
  }

  const primary = source.slice(0, maxLegendItems).map((item, index) => ({
    category: item.category,
    amount: item.amount,
    color: categoryColor(item.category, index)
  }));
  const otherAmount = source
    .slice(maxLegendItems)
    .reduce((sum, item) => sum + item.amount, 0);
  const grouped = otherAmount > 0
    ? [
        ...primary,
        {
          category: 'Other',
          amount: otherAmount,
          color: 'var(--text-subtle)'
        }
      ]
    : primary;

  const targetCellCount = 140;
  const rawCells = grouped.map((item) => ({
    ...item,
    rawCells: (item.amount / total) * targetCellCount
  }));
  let assigned = 0;
  const rounded = rawCells.map((item) => {
    const cells = Math.floor(item.rawCells);
    assigned += cells;
    return { ...item, cells, remainder: item.rawCells - cells };
  });
  let remaining = targetCellCount - assigned;
  const byRemainder = [...rounded].sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < byRemainder.length && remaining > 0; index += 1, remaining -= 1) {
    byRemainder[index].cells += 1;
  }

  const legend = grouped.map((item) => {
    const match = byRemainder.find((entry) => entry.category === item.category);
    return {
      category: item.category,
      amount: item.amount,
      percent: (item.amount / total) * 100,
      cells: match?.cells ?? 0,
      color: item.color
    };
  });
  const cells = legend.flatMap((item, index) =>
    Array.from({ length: item.cells }, (_, cellIndex) => ({
      id: `${item.category}-${index}-${cellIndex}`,
      category: item.category,
      color: item.color,
      amount: item.amount,
      percent: item.percent
    }))
  );

  return { cells, legend, total };
}

export function CategoryWaffleChart({
  items,
  maxLegendItems = 6,
  caption = 'Each square represents about 1% of the total.',
  onLegendClick,
  compact = false
}: CategoryWaffleChartProps) {
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const waffle = buildWaffle(items, maxLegendItems);
  const dollarsPerDot = waffle.total > 0 ? waffle.total / 140 : 0;
  const captionText = dollarsPerDot > 0 ? caption : caption;

  function handleGridPointerOver(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    setHoveredCategory(target.dataset.category ?? null);
  }

  return (
    <div className={`waffle-card ${compact ? 'compact' : ''}`}>
      {dollarsPerDot > 0 && (
        <p className="waffle-meta">${dollarsPerDot.toFixed(0)} per dot</p>
      )}
      <div
        className="waffle-grid"
        aria-label="Category waffle chart"
        role="img"
        onPointerOver={handleGridPointerOver}
        onPointerLeave={() => setHoveredCategory(null)}
      >
        {waffle.cells.map((cell) => (
          <span
            key={cell.id}
            data-category={cell.category}
            className={`waffle-cell ${
              hoveredCategory === null
                ? ''
                : hoveredCategory === cell.category
                  ? 'is-highlighted'
                  : 'is-dimmed'
            }`}
            style={{ background: cell.color }}
            title={`${cell.category}: $${cell.amount.toFixed(0)} (${cell.percent.toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="waffle-legend" aria-label="Category legend">
        {waffle.legend.map((item) => (
          <div key={item.category} className="waffle-legend-row">
            <button
              type="button"
              className={`waffle-legend-button ${onLegendClick ? 'is-clickable' : ''} ${
                hoveredCategory === null
                  ? ''
                  : hoveredCategory === item.category
                    ? 'is-highlighted'
                    : 'is-dimmed'
              }`}
              onClick={() => onLegendClick?.(item.category)}
              onPointerEnter={() => setHoveredCategory(item.category)}
              onPointerLeave={() => setHoveredCategory(null)}
            >
              <span
                className="swatch"
                style={{ background: item.color }}
                aria-hidden="true"
              />
              {item.category}
            </button>
            <span>
              ${item.amount.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
      <p className="budget-caption">{captionText}</p>
    </div>
  );
}
