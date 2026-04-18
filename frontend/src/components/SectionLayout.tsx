import { ReactNode, useEffect, useMemo, useState } from 'react';

type SectionDefinition = {
  id: string;
  label: string;
  defaultCollapsed?: boolean;
  content: ReactNode;
};

type Props = {
  pageKey: string;
  title: string;
  intro?: ReactNode;
  sections: SectionDefinition[];
  expandAllByDefault?: boolean;
};

function storageKey(pageKey: string) {
  return `bt_sections_${pageKey}`;
}

function defaultCollapsedFor(
  section: SectionDefinition,
  index: number,
  expandAllByDefault: boolean
): boolean {
  if (expandAllByDefault) return false;
  if (section.defaultCollapsed != null) return Boolean(section.defaultCollapsed);
  return index > 0;
}

export function SectionLayout({
  pageKey,
  title,
  intro,
  sections,
  expandAllByDefault = false
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const sectionIds = useMemo(
    () => sections.map((section) => section.id),
    [sections]
  );
  const sectionIdsKey = sectionIds.join('|');

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(pageKey));
    if (!saved) {
      const defaults: Record<string, boolean> = {};
      for (const [index, section] of sections.entries()) {
        defaults[section.id] = defaultCollapsedFor(
          section,
          index,
          expandAllByDefault
        );
      }
      setCollapsed(defaults);
      return;
    }
    try {
      const parsed = JSON.parse(saved) as Record<string, boolean>;
      const merged: Record<string, boolean> = {};
      for (const [index, section] of sections.entries()) {
        merged[section.id] =
          parsed[section.id] ??
          defaultCollapsedFor(section, index, expandAllByDefault);
      }
      setCollapsed(merged);
    } catch {
      setCollapsed({});
    }
  }, [pageKey, sectionIdsKey, expandAllByDefault]);

  useEffect(() => {
    window.localStorage.setItem(storageKey(pageKey), JSON.stringify(collapsed));
  }, [collapsed, pageKey]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) {
          setActiveId(visible.target.id);
        }
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0.2, 0.5, 0.8] }
    );

    for (const id of sectionIds) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sectionIdsKey]);

  const orderedSections = useMemo(() => sections, [sections]);

  function jumpTo(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: false }));
    const element = document.getElementById(id);
    if (!element) return;
    window.history.replaceState(null, '', `#${id}`);
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function toggle(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="section-layout">
      <aside className="section-nav" aria-label={`${title} sections`}>
        <h3>{title}</h3>
        <nav>
          {orderedSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeId === section.id ? 'active' : ''}
              onClick={() => jumpTo(section.id)}
              title={`Jump to ${section.label}`}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="section-main">
        <h2>{title}</h2>
        {intro}
        {orderedSections.map((section, index) => {
          const isCollapsed =
            collapsed[section.id] ??
            defaultCollapsedFor(section, index, expandAllByDefault);
          return (
            <section
              key={section.id}
              id={section.id}
              className="jump-section card"
            >
              <header className="jump-header">
                <h3>{section.label}</h3>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => toggle(section.id)}
                  aria-expanded={!isCollapsed}
                  title={
                    isCollapsed
                      ? `Expand ${section.label}`
                      : `Collapse ${section.label}`
                  }
                >
                  {isCollapsed ? 'Expand' : 'Collapse'}
                </button>
              </header>
              {!isCollapsed && (
                <div className="jump-content">{section.content}</div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
