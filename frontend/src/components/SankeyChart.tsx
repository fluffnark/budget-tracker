import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';

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
  width = 900,
  height = 380
}: {
  nodes: SankeyNode[];
  links: Link[];
  width?: number;
  height?: number;
}) {
  const [hovered, setHovered] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [interactionEnabled, setInteractionEnabled] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const generator = useMemo(
    () =>
      d3Sankey<SankeyNode, Link>()
        .nodeWidth(12)
        .nodePadding(14)
        .extent([
          [0, 0],
          [width, height]
        ]),
    [width, height]
  );

  if (!nodes.length || !links.length) {
    return <p>No Sankey data for selected range.</p>;
  }

  const graph = generator({
    nodes: nodes.map((n) => ({ ...n })),
    links: links.map((l) => ({ ...l }))
  });

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
    if (node.kind === 'outcome') {
      if (node.name === 'Living Expenses') return '🧾';
      if (node.name === 'Travel') return '✈️';
      if (node.name === 'Debt Service') return '💳';
      if (node.name === 'Savings & Investing') return '📈';
      if (node.name === 'Internal Transfers') return '🔁';
      return '📊';
    }
    return '•';
  }

  function clampLabel(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(3, maxChars - 1))}…`;
  }

  const outcomeLegend = Array.from(
    new Map(
      graph.nodes
        .filter((node) => node.kind === 'outcome')
        .map((node) => [node.name, { label: node.name, color: nodeFill(node) }])
    ).values()
  );
  const baseLegend = [
    { label: 'Income / Sources', color: kindPalette.source },
    { label: 'Cash hubs (accounts)', color: kindPalette.account }
  ];
  const legendItems =
    outcomeLegend.length > 0
      ? [...baseLegend, ...outcomeLegend]
      : [
          { label: 'Accounts', color: kindPalette.account },
          { label: 'Categories / Details', color: kindPalette.category }
        ];
  const legendLineHeight = 18;
  const legendPad = 8;
  const legendWidth = 240;
  const legendHeight = (legendItems.length * legendLineHeight) + (legendPad * 2);
  const legendX = 12;
  const legendY = Math.max(12, height - legendHeight - 12);

  function clampZoom(next: number) {
    return Math.max(0.5, Math.min(4.5, next));
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    if (!interactionEnabled) return;
    event.preventDefault();
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const pointerX = ((event.clientX - rect.left) / rect.width) * width;
    const pointerY = ((event.clientY - rect.top) / rect.height) * height;
    const factor = Math.exp(-event.deltaY * 0.0014);
    const nextZoom = clampZoom(zoom * factor);
    const contentX = (pointerX - pan.x) / zoom;
    const contentY = (pointerY - pan.y) / zoom;
    const nextPan = {
      x: pointerX - contentX * nextZoom,
      y: pointerY - contentY * nextZoom
    };
    setZoom(nextZoom);
    setPan(nextPan);
  }

  function handleMouseDown(event: ReactMouseEvent<SVGSVGElement>) {
    if (!interactionEnabled) {
      setInteractionEnabled(true);
      return;
    }
    dragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      startX: pan.x,
      startY: pan.y
    };
    setDragging(true);
  }

  function handleMouseMove(event: ReactMouseEvent<SVGSVGElement>) {
    if (!dragging || !dragStartRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = ((event.clientX - dragStartRef.current.clientX) / rect.width) * width;
    const dy = ((event.clientY - dragStartRef.current.clientY) / rect.height) * height;
    setPan({
      x: dragStartRef.current.startX + dx,
      y: dragStartRef.current.startY + dy
    });
  }

  function stopDragging() {
    setDragging(false);
    dragStartRef.current = null;
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div>
      <p className="sankey-hover">
        {hovered ||
          'Click chart to enable zoom/pan. When disabled, page scroll works normally.'}
      </p>
      <div className="row-actions" style={{ marginBottom: 8 }}>
        <button
          type="button"
          className={interactionEnabled ? '' : 'secondary'}
          onClick={() => {
            setInteractionEnabled((prev) => !prev);
            if (interactionEnabled) {
              setDragging(false);
              dragStartRef.current = null;
            }
          }}
          title={
            interactionEnabled
              ? 'Disable chart interaction and return wheel scrolling to the page'
              : 'Enable chart zoom and pan controls'
          }
        >
          {interactionEnabled ? 'Chart interaction: ON' : 'Chart interaction: OFF'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setInteractionEnabled(false);
            setDragging(false);
            dragStartRef.current = null;
          }}
          title="Disable interaction mode"
        >
          Exit interaction
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="sankey-svg"
        role="img"
        aria-label="Sankey chart"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
        onDoubleClick={resetView}
        style={{
          cursor: interactionEnabled ? (dragging ? 'grabbing' : 'grab') : 'default'
        }}
      >
        <g transform={`translate(${pan.x} ${pan.y})`}>
          <g transform={`scale(${zoom})`}>
            <g>
              {graph.links.map((link, idx) => {
                const sourceNode =
                  typeof link.source === 'number'
                    ? graph.nodes[link.source]
                    : (link.source as SankeyNode);
                const targetNode =
                  typeof link.target === 'number'
                    ? graph.nodes[link.target]
                    : (link.target as SankeyNode);
                const value = Number(link.value ?? 0);
                const label = `${sourceNode.name} → ${targetNode.name}: $${value.toFixed(2)}`;
                return (
                  <path
                    key={idx}
                    d={sankeyLinkHorizontal()(link) ?? ''}
                    stroke={nodeFill(targetNode)}
                    strokeWidth={Math.max(1, link.width ?? 1)}
                    fill="none"
                    opacity={0.38}
                    onMouseEnter={() => setHovered(label)}
                    onMouseLeave={() => setHovered('')}
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
                const nodeColor = nodeFill(node);
                const iconPrefix = `${nodeIcon(node)} `;
                const label = `${iconPrefix}${node.name} ($${value.toFixed(2)})`;
                const rightSide = x > width * 0.72;
                const textX = rightSide ? x - 6 : (node.x1 ?? 0) + 6;
                const textAnchor = rightSide ? 'end' : 'start';
                const visibleName = clampLabel(
                  node.name,
                  rightSide ? 34 : 40
                );
                return (
                  <g key={idx}>
                    <rect
                      x={x}
                      y={y}
                      width={(node.x1 ?? 0) - x}
                      height={Math.max(1, h)}
                      fill={nodeColor}
                      onMouseEnter={() => setHovered(label)}
                      onMouseLeave={() => setHovered('')}
                    >
                      <title>{label}</title>
                    </rect>
                    <text
                      x={textX}
                      y={y + 12}
                      fontSize={12}
                      fill="var(--fg)"
                      textAnchor={textAnchor}
                      stroke="var(--card-bg)"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {iconPrefix}
                      {visibleName}
                      <title>{label}</title>
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </g>
        <g className="sankey-legend" transform={`translate(${legendX} ${legendY})`}>
          <rect
            x={0}
            y={0}
            rx={10}
            ry={10}
            width={legendWidth}
            height={legendHeight}
            fill="var(--card-bg)"
            stroke="var(--border)"
          />
          {legendItems.map((item, idx) => {
            const y = legendPad + (idx * legendLineHeight) + 10;
            return (
              <g key={item.label} transform={`translate(${legendPad} ${y})`}>
                <circle cx={7} cy={0} r={5} fill={item.color} />
                <text x={18} y={4} fontSize={12} fill="var(--fg)">
                  {item.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
