import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../api';
import {
  getWorkspaceSection,
  PRIMARY_MOBILE_SECTION_IDS,
  WORKSPACE_DEFAULT_SECTION_ID,
  WORKSPACE_GROUP_LABELS,
  WORKSPACE_SECTIONS
} from '../workspace/sections';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const routeSectionId =
    location.pathname.split('/').filter(Boolean)[0] ?? WORKSPACE_DEFAULT_SECTION_ID;
  const activeSection = getWorkspaceSection(routeSectionId);
  const activeId = activeSection.id;
  const groupedSections = useMemo(
    () =>
      Object.entries(WORKSPACE_GROUP_LABELS).map(([group, label]) => ({
        group,
        label,
        sections: WORKSPACE_SECTIONS.filter((section) => section.group === group)
      })),
    []
  );
  const mobilePrimarySections = WORKSPACE_SECTIONS.filter((section) =>
    PRIMARY_MOBILE_SECTION_IDS.includes(section.id)
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const apply = () => {
      const mobile = media.matches;
      setIsMobile(mobile);
      if (mobile) {
        setNavOpen(false);
        return;
      }
      setNavOpen(true);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setNavOpen(false);
    }
    const content = document.querySelector('.content');
    if (
      content instanceof HTMLElement &&
      typeof content.scrollTo === 'function'
    ) {
      content.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [isMobile, location.pathname]);

  function openSection(id: string) {
    if (id !== activeId) {
      navigate(`/${id}`);
    }
    if (isMobile) {
      setNavOpen(false);
    }
  }

  async function logout() {
    const confirmed = window.confirm('Log out of Budget Tracker?');
    if (!confirmed) return;
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout API failures and still route back to login.
    }
    navigate('/login', { replace: true });
  }

  function toggleNav() {
    setNavOpen((prev) => {
      const next = !prev;
      return next;
    });
  }

  return (
    <div
      className={`app-shell ${!navOpen ? 'sidebar-collapsed' : ''} ${
        isMobile ? 'sidebar-mobile' : ''
      }`}
    >
      <aside className={`sidebar ${navOpen ? 'open' : 'collapsed'}`}>
        <div className="sidebar-head">
          <h1>Budget Tracker</h1>
        </div>
        <p className="sidebar-subtitle">Focus Workspace</p>
        {groupedSections.map((group) => (
          <div key={group.group} className="sidebar-group">
            <h2>{group.label}</h2>
            <nav>
              {group.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={activeId === section.id ? 'active' : ''}
                  onClick={() => openSection(section.id)}
                >
                  <span>{section.label}</span>
                  <small>{section.description}</small>
                </button>
              ))}
            </nav>
          </div>
        ))}
        <button type="button" className="sidebar-logout" onClick={logout}>
          Logout
        </button>
      </aside>
      {isMobile && navOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <button
        type="button"
        className={`sidebar-edge-toggle ${isMobile ? 'mobile' : 'desktop'} ${
          navOpen ? 'open' : 'closed'
        }`}
        onClick={toggleNav}
        aria-expanded={navOpen}
        aria-label={navOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        title={navOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <rect x="2.5" y="3" width="15" height="14" rx="2" />
          <line x1="7.4" y1="3.2" x2="7.4" y2="16.8" />
          {navOpen ? (
            <polyline points="12.8,7 10.3,10 12.8,13" />
          ) : (
            <polyline points="10.3,7 12.8,10 10.3,13" />
          )}
        </svg>
      </button>
      <main className="content">
        <header className="workspace-focus-bar">
          <div>
            <span className="workspace-eyebrow">
              {WORKSPACE_GROUP_LABELS[activeSection.group]}
            </span>
            <h2>{activeSection.label}</h2>
          </div>
          {isMobile && (
            <button
              type="button"
              className="secondary"
              onClick={toggleNav}
              aria-expanded={navOpen}
            >
              Browse Modules
            </button>
          )}
        </header>
        <Outlet />
      </main>
      {isMobile && (
        <nav className="mobile-dock" aria-label="Primary modules">
          {mobilePrimarySections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeId === section.id ? 'active' : ''}
              onClick={() => openSection(section.id)}
            >
              {section.shortLabel}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
