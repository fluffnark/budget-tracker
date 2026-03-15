import { ReactNode, useEffect, useState } from 'react';

type ExpandableChartProps = {
  label: string;
  height?: number;
  mobileHeight?: number;
  expandedHeight?: number;
  mobileExpandedHeight?: number;
  autoExpandOnMobile?: boolean;
  children: (height: number, expanded: boolean) => ReactNode;
};

export function ExpandableChart({
  label,
  height = 300,
  mobileHeight = 360,
  expandedHeight = 620,
  mobileExpandedHeight = 760,
  autoExpandOnMobile = true,
  children
}: ExpandableChartProps) {
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const inlineExpanded = isMobile && autoExpandOnMobile;
  const inlineHeight = inlineExpanded ? mobileExpandedHeight : (isMobile ? mobileHeight : height);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  return (
    <>
      <div className="chart-expand-wrap">
        {!inlineExpanded && (
          <button
            type="button"
            className="secondary chart-expand-btn"
            onClick={() => setExpanded(true)}
            title={`Expand ${label}`}
            aria-label={`Expand ${label}`}
          >
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
              <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4" />
              <path d="M8 4H4v4M12 4h4v4M16 12v4h-4M4 12v4h4" opacity="0" />
            </svg>
          </button>
        )}
        <div style={{ height: inlineHeight }}>
          {children(inlineHeight, inlineExpanded)}
        </div>
      </div>
      {expanded && !inlineExpanded && (
        <div className="modal-overlay" onClick={() => setExpanded(false)}>
          <div
            className="modal chart-expand-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chart-expand-head">
              <h3>{label}</h3>
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded(false)}
                title={`Close ${label} fullscreen`}
              >
                Close
              </button>
            </div>
            <div style={{ height: expandedHeight }}>
              {children(expandedHeight, true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
