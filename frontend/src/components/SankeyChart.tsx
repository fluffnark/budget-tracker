import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
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
  height = 380,
  expanded = false,
  focused = false
}: {
  nodes: SankeyNode[];
  links: Link[];
  width?: number;
  height?: number;
  expanded?: boolean;
  focused?: boolean;
}) {
  const [hovered, setHovered] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [interactionEnabled, setInteractionEnabled] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [containerWidth, setContainerWidth] = useState(width);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const touchDragRef = useRef<{
    mode: 'pan' | 'pinch';
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    startDistance?: number;
    startZoom?: number;
    startContentX?: number;
    startContentY?: number;
  } | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const apply = () => setIsCoarsePointer(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (isCoarsePointer) {
      setInteractionEnabled(true);
    }
  }, [isCoarsePointer]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? width;
      setContainerWidth(nextWidth);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [width]);

  const hasGroupedFlow = useMemo(
    () => nodes.some((node) => node.kind === 'group'),
    [nodes]
  );
  const compact = containerWidth < 720;
  const contentWidth = compact && hasGroupedFlow ? Math.max(width, 1320) : width;
  const topPadding = 34;
  const maxNodesPerColumn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return Math.max(1, ...counts.values());
  }, [nodes]);
  const contentHeight =
    hasGroupedFlow
      ? Math.max(height, maxNodesPerColumn * (compact ? 52 : 42) + 140)
      : height;

  const generator = useMemo(
    () =>
      d3Sankey<SankeyNode, Link>()
        .nodeWidth(hasGroupedFlow ? (expanded ? 18 : 16) : expanded ? 14 : 12)
        .nodePadding(hasGroupedFlow ? (compact ? 18 : 16) : expanded ? 16 : 14)
        .extent([
          [0, topPadding],
          [contentWidth, contentHeight]
        ]),
    [contentWidth, contentHeight, expanded, compact, hasGroupedFlow, topPadding]
  );
  const hasData = nodes.length > 0 && links.length > 0;
  const graph = hasData
    ? generator({
        nodes: nodes.map((n) => ({ ...n })),
        links: links.map((l) => ({ ...l }))
      })
    : null;

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
      if (current) {
        lines.push(current);
        current = word;
      } else {
        lines.push(clampLabel(word, maxCharsPerLine));
      }
      if (lines.length >= maxLines) break;
    }

    if (lines.length < maxLines && current) lines.push(current);

    const joined = words.join(' ');
    const built = lines.join(' ');
    if (joined.length > built.length && lines.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = clampLabel(last, maxCharsPerLine);
    }
    return lines.slice(0, maxLines);
  }

  useEffect(() => {
    if (!interactionEnabled || isCoarsePointer) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    const preventWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    wrapper.addEventListener('wheel', preventWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', preventWheel);
  }, [interactionEnabled, isCoarsePointer]);

  useEffect(() => {
    document.body.classList.toggle(
      'sankey-interaction-lock',
      interactionEnabled && !isCoarsePointer
    );
    return () => document.body.classList.remove('sankey-interaction-lock');
  }, [interactionEnabled, isCoarsePointer]);

  useEffect(() => {
    if (!expanded) return;
    const compactFocus = focused || nodes.length <= 18;
    setZoom(
      hasGroupedFlow
        ? compactFocus
          ? 1.34
          : 1.06
        : compactFocus
          ? 1.28
          : 1.14
    );
    setPan({
      x: hasGroupedFlow ? (compactFocus ? -92 : -28) : compactFocus ? -72 : -56,
      y: hasGroupedFlow ? (compactFocus ? -18 : -6) : compactFocus ? -14 : -10
    });
  }, [expanded, focused, hasGroupedFlow, nodes.length]);

  if (!graph) {
    return <p>No Sankey data for selected range.</p>;
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
    hasGroupedFlow
      ? [
          { label: 'Accounts', color: kindPalette.account },
          ...graph.nodes
            .filter((node) => node.kind === 'group')
            .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
            .slice(0, compact ? 4 : 6)
            .map((node) => ({ label: node.name, color: nodeFill(node) }))
        ]
      : outcomeLegend.length > 0
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
  const legendY = Math.max(12, contentHeight - legendHeight - 12);
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

  function clampZoom(next: number) {
    return Math.max(0.5, Math.min(4.5, next));
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    if (!interactionEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const pointerX = ((event.clientX - rect.left) / rect.width) * contentWidth;
    const pointerY = ((event.clientY - rect.top) / rect.height) * contentHeight;
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
    event.preventDefault();
    event.stopPropagation();
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
    event.preventDefault();
    event.stopPropagation();
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = ((event.clientX - dragStartRef.current.clientX) / rect.width) * contentWidth;
    const dy = ((event.clientY - dragStartRef.current.clientY) / rect.height) * contentHeight;
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

  function readTouchDistance(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length < 2) return 0;
    const a = event.touches[0];
    const b = event.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function readTouchCenter(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length === 0) return { x: 0, y: 0 };
    if (event.touches.length === 1) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    const a = event.touches[0];
    const b = event.touches[1];
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }

  function mapClientToChart(clientX: number, clientY: number) {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      rect,
      x: ((clientX - rect.left) / rect.width) * contentWidth,
      y: ((clientY - rect.top) / rect.height) * contentHeight
    };
  }

  function handleTouchStart(event: ReactTouchEvent<SVGSVGElement>) {
    if (!interactionEnabled || !svgRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.touches.length >= 2) {
      const center = readTouchCenter(event);
      const mapped = mapClientToChart(center.x, center.y);
      if (!mapped) return;
      const startDistance = readTouchDistance(event);
      touchDragRef.current = {
        mode: 'pinch',
        startX: center.x,
        startY: center.y,
        startPanX: pan.x,
        startPanY: pan.y,
        startDistance,
        startZoom: zoom,
        startContentX: (mapped.x - pan.x) / zoom,
        startContentY: (mapped.y - pan.y) / zoom
      };
      return;
    }

    const first = event.touches[0];
    if (!first) return;
    touchDragRef.current = {
      mode: 'pan',
      startX: first.clientX,
      startY: first.clientY,
      startPanX: pan.x,
      startPanY: pan.y
    };
    setDragging(true);
  }

  function handleTouchMove(event: ReactTouchEvent<SVGSVGElement>) {
    if (!interactionEnabled || !touchDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const drag = touchDragRef.current;
    if (drag.mode === 'pinch' && event.touches.length >= 2) {
      const center = readTouchCenter(event);
      const mapped = mapClientToChart(center.x, center.y);
      if (!mapped || !drag.startDistance || !drag.startZoom) return;
      const nextDistance = readTouchDistance(event);
      if (nextDistance <= 0) return;
      const nextZoom = clampZoom(drag.startZoom * (nextDistance / drag.startDistance));
      const startContentX = drag.startContentX ?? 0;
      const startContentY = drag.startContentY ?? 0;
      setZoom(nextZoom);
      setPan({
        x: mapped.x - startContentX * nextZoom,
        y: mapped.y - startContentY * nextZoom
      });
      return;
    }

    if (drag.mode === 'pan' && event.touches.length === 1) {
      const first = event.touches[0];
      const mapped = mapClientToChart(first.clientX, first.clientY);
      if (!mapped) return;
      const dx = ((first.clientX - drag.startX) / mapped.rect.width) * contentWidth;
      const dy = ((first.clientY - drag.startY) / mapped.rect.height) * contentHeight;
      setPan({
        x: drag.startPanX + dx,
        y: drag.startPanY + dy
      });
    }
  }

  function handleTouchEnd() {
    if (!interactionEnabled) return;
    setDragging(false);
    touchDragRef.current = null;
  }

  return (
    <div
      ref={wrapperRef}
      className={`sankey-shell${interactionEnabled ? ' interaction-on' : ''}`}
    >
      <p className="sankey-hover">
        {hovered ||
          (hasGroupedFlow
            ? 'Flow reads left to right: accounts, category groups, then final categories.'
            : isCoarsePointer
              ? 'Pinch to zoom and drag to pan.'
              : 'Click chart to enable zoom/pan. When disabled, page scroll works normally.')}
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
        viewBox={`0 0 ${contentWidth} ${contentHeight}`}
        className="sankey-svg"
        role="img"
        aria-label="Sankey chart"
        onWheel={handleWheel}
        onWheelCapture={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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
                const isFinalColumn =
                  node.kind === 'category' ||
                  node.kind === 'detail' ||
                  x > contentWidth * 0.72;
                const isMiddleColumn =
                  node.kind === 'group' || node.kind === 'outcome';
                const textX = isMiddleColumn
                  ? ((node.x1 ?? 0) + x) / 2
                  : isFinalColumn
                    ? x - 8
                    : (node.x1 ?? 0) + 8;
                const textAnchor = isMiddleColumn
                  ? 'middle'
                  : isFinalColumn
                    ? 'end'
                    : 'start';
                const displayName =
                  isFinalColumn && (node.kind === 'detail' || node.kind === 'category')
                    ? simplifyTerminalName(node.name)
                    : node.name;
                const labelLines = wrapLabel(
                  displayName,
                  isMiddleColumn
                    ? compact
                      ? 14
                      : 18
                    : isFinalColumn
                      ? expanded
                        ? 20
                        : compact
                          ? 14
                          : 16
                      : expanded
                        ? 28
                        : compact
                          ? 18
                          : 24,
                  compact ? 1 : 2
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
                      y={y + (compact ? 11 : 12)}
                      fontSize={compact ? 11.5 : expanded ? 14 : 12.5}
                      fill="var(--fg)"
                      textAnchor={textAnchor}
                      stroke="var(--card-bg)"
                      strokeWidth={compact ? 3.5 : expanded ? 4 : 3}
                      paintOrder="stroke"
                    >
                      {labelLines.map((line, lineIdx) => (
                        <tspan
                          key={lineIdx}
                          x={textX}
                          dy={lineIdx === 0 ? 0 : compact ? 12 : 13}
                        >
                          {lineIdx === 0 ? iconPrefix : ''}
                          {line}
                        </tspan>
                      ))}
                      <title>{label}</title>
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </g>
        <g className="sankey-columns">
          {columnHeaders.map((column) => (
            <text
              key={column.kind}
              x={column.x}
              y={20}
              fontSize={compact ? 12 : 13}
              fontWeight={700}
              textAnchor="middle"
              fill="var(--text-muted)"
            >
              {column.label}
            </text>
          ))}
        </g>
        <g className="sankey-legend" transform={`translate(${legendX} ${legendY})`}>
          {!compact && (
            <>
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
                    <text x={18} y={4} fontSize={expanded ? 13 : 12} fill="var(--fg)">
                      {item.label}
                    </text>
                  </g>
                );
              })}
            </>
          )}
        </g>
      </svg>
    </div>
  );
}
