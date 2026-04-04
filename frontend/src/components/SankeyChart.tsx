import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { useEffect, useMemo, useRef, useState } from 'react';

type SankeyNode = {
  name: string;
  kind: string;
  color?: string | null;
  icon?: string | null;
  category_id?: number | null;
};

type Link = { source: number; target: number; value: number };

export function SankeyChart({
  nodes,
  links,
  height = 320
}: {
  nodes: SankeyNode[];
  links: Link[];
  height?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const chartWidth = Math.max(320, Math.floor(containerWidth || 0));
  const hasData = nodes.length > 0 && links.length > 0;
  const hasGroupedFlow = useMemo(
    () => nodes.some((node) => node.kind === 'group'),
    [nodes]
  );
  const compact = chartWidth < 760;
  const maxNodesPerColumn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return Math.max(1, ...counts.values());
  }, [nodes]);
  const leftLabelSpace = compact ? 92 : 136;
  const rightLabelSpace = compact ? 100 : 156;
  const topPadding = 30;
  const bottomPadding = compact ? 18 : 72;
  const nodeWidth = hasGroupedFlow ? (compact ? 12 : 16) : compact ? 10 : 12;
  const nodePadding = Math.max(
    compact ? 6 : 8,
    Math.min(compact ? 16 : 20, Math.floor((height - 92) / maxNodesPerColumn))
  );
  const innerWidth = Math.max(180, chartWidth - leftLabelSpace - rightLabelSpace);
  const innerHeight = Math.max(180, height - topPadding - bottomPadding);

  const graph = useMemo(() => {
    if (!hasData) return null;
    return d3Sankey<SankeyNode, Link>()
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .extent([
        [leftLabelSpace, topPadding],
        [leftLabelSpace + innerWidth, topPadding + innerHeight]
      ])({
        nodes: nodes.map((node) => ({ ...node })),
        links: links.map((link) => ({ ...link }))
      });
  }, [
    hasData,
    innerHeight,
    innerWidth,
    leftLabelSpace,
    links,
    nodePadding,
    nodeWidth,
    nodes
  ]);

  const outcomePalette: Record<string, string> = {
    'Living Expenses': 'var(--series-1)',
    Travel: 'var(--series-4)',
    'Debt Service': 'var(--danger)',
    'Savings & Investing': 'var(--series-5)',
    'Internal Transfers': 'var(--text-subtle)'
  };

  const kindPalette: Record<string, string> = {
    source: 'var(--series-2)',
    account: 'var(--primary)',
    group: 'var(--series-3)',
    outcome: 'var(--series-1)',
    detail: 'var(--series-3)',
    category: 'var(--series-2)'
  };

  function nodeFill(node: SankeyNode) {
    if (node.color) return node.color;
    if (node.kind === 'outcome' && outcomePalette[node.name]) {
      return outcomePalette[node.name];
    }
    return kindPalette[node.kind] ?? 'var(--series-2)';
  }

  function nodeIcon(node: SankeyNode): string {
    if (node.icon && node.icon.trim()) return node.icon;
    if (node.kind === 'source') return '💼';
    if (node.kind === 'account') return '🏦';
    if (node.kind === 'category' || node.kind === 'detail') return '🏷️';
    if (node.kind === 'outcome') return '📊';
    return '•';
  }

  function clampLabel(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(3, maxChars - 1))}…`;
  }

  function simplifyTerminalName(text: string) {
    let name = text.trim();
    if (name.includes('→')) {
      const parts = name.split('→');
      name = parts[parts.length - 1]?.trim() ?? name;
    }
    if (name.includes('>')) {
      const parts = name.split('>');
      name = parts[parts.length - 1]?.trim() ?? name;
    }
    return name;
  }

  function wrapLabel(text: string, maxCharsPerLine: number, maxLines = 2): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && current) lines.push(current);
    if (lines.length > maxLines) return lines.slice(0, maxLines);
    if (words.join(' ').length > lines.join(' ').length && lines.length) {
      lines[lines.length - 1] = clampLabel(lines[lines.length - 1], maxCharsPerLine);
    }
    return lines;
  }

  if (!graph) {
    return (
      <div ref={wrapperRef} className="sankey-shell">
        <p>No Sankey data for selected range.</p>
      </div>
    );
  }

  const columnLabels: Record<string, string> = {
    source: 'Sources',
    account: 'Accounts',
    group: 'Groups',
    outcome: 'Sections',
    detail: 'Final Categories',
    category: hasGroupedFlow ? 'Final Categories' : 'Categories'
  };

  const columnHeaders = Array.from(
    new Map(
      graph.nodes
        .slice()
        .sort((a, b) => (a.x0 ?? 0) - (b.x0 ?? 0))
        .map((node) => [
          node.kind,
          {
            kind: node.kind,
            label: columnLabels[node.kind] ?? node.kind,
            x: ((node.x0 ?? 0) + (node.x1 ?? 0)) / 2
          }
        ])
    ).values()
  );

  const legendItems = hasGroupedFlow
    ? graph.nodes
        .filter((node) => node.kind === 'group')
        .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
        .slice(0, compact ? 3 : 5)
        .map((node) => ({ label: node.name, color: nodeFill(node) }))
    : [
        { label: 'Accounts', color: kindPalette.account },
        { label: 'Categories', color: kindPalette.category }
      ];

  return (
    <div ref={wrapperRef} className="sankey-shell">
      <svg
        className="sankey-svg"
        role="img"
        aria-label="Sankey chart"
        viewBox={`0 0 ${chartWidth} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g>
          {graph.links.map((link, idx) => {
            const targetNode =
              typeof link.target === 'number' ? graph.nodes[link.target] : link.target;
            const sourceNode =
              typeof link.source === 'number' ? graph.nodes[link.source] : link.source;
            const value = Number(link.value ?? 0);
            const label = `${sourceNode.name} -> ${targetNode.name}: $${value.toFixed(0)}`;
            return (
              <path
                key={idx}
                d={sankeyLinkHorizontal()(link) ?? ''}
                stroke={nodeFill(targetNode)}
                strokeWidth={Math.max(1, link.width ?? 1)}
                fill="none"
                opacity={0.34}
              >
                <title>{label}</title>
              </path>
            );
          })}
        </g>
        <g>
          {graph.nodes.map((node, idx) => {
            const x = node.x0 ?? 0;
            const y = node.y0 ?? 0;
            const h = (node.y1 ?? 0) - (node.y0 ?? 0);
            const value = Number(node.value ?? 0);
            const isFinalColumn =
              node.kind === 'category' || node.kind === 'detail' || x > chartWidth * 0.72;
            const isMiddleColumn = node.kind === 'group' || node.kind === 'outcome';
            const textX = isMiddleColumn ? ((node.x1 ?? 0) + x) / 2 : isFinalColumn ? x - 8 : (node.x1 ?? 0) + 8;
            const textAnchor = isMiddleColumn ? 'middle' : isFinalColumn ? 'end' : 'start';
            const displayName =
              isFinalColumn && (node.kind === 'detail' || node.kind === 'category')
                ? simplifyTerminalName(node.name)
                : node.name;
            const labelLines = wrapLabel(
              displayName,
              isMiddleColumn ? (compact ? 12 : 16) : isFinalColumn ? (compact ? 14 : 18) : compact ? 16 : 22,
              compact ? 1 : 2
            );
            const title = `${nodeIcon(node)} ${node.name} ($${value.toFixed(0)})`;
            return (
              <g key={idx}>
                <rect
                  x={x}
                  y={y}
                  width={(node.x1 ?? 0) - x}
                  height={Math.max(1, h)}
                  fill={nodeFill(node)}
                  rx={4}
                  ry={4}
                >
                  <title>{title}</title>
                </rect>
                <text
                  x={textX}
                  y={y + (compact ? 11 : 12)}
                  fontSize={compact ? 11 : 12}
                  fill="var(--fg)"
                  textAnchor={textAnchor}
                  stroke="var(--card-bg)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {labelLines.map((line, lineIdx) => (
                    <tspan key={lineIdx} x={textX} dy={lineIdx === 0 ? 0 : 12}>
                      {lineIdx === 0 ? `${nodeIcon(node)} ` : ''}
                      {line}
                    </tspan>
                  ))}
                  <title>{title}</title>
                </text>
              </g>
            );
          })}
        </g>
        <g className="sankey-columns">
          {columnHeaders.map((column) => (
            <text
              key={column.kind}
              x={column.x}
              y={20}
              fontSize={12}
              fontWeight={700}
              textAnchor="middle"
              fill="var(--text-muted)"
            >
              {column.label}
            </text>
          ))}
        </g>
        {!compact && legendItems.length > 0 && (
          <g className="sankey-legend" transform={`translate(12 ${height - 20 - legendItems.length * 16})`}>
            {legendItems.map((item, idx) => (
              <g key={item.label} transform={`translate(0 ${idx * 16})`}>
                <circle cx={6} cy={0} r={4} fill={item.color} />
                <text x={16} y={4} fontSize={11} fill="var(--fg)">
                  {clampLabel(item.label, 28)}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
