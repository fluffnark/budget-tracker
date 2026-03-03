import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';

import { WORKSPACE_SECTIONS } from '../pages/WorkspacePage';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState(WORKSPACE_SECTIONS[0]?.id ?? '');
  const [isMobile, setIsMobile] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const sectionIds = useMemo(
    () => WORKSPACE_SECTIONS.map((section) => section.id),
    []
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
      const saved = window.localStorage.getItem('bt_nav_open');
      setNavOpen(saved ? saved === '1' : true);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

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
  }, [location.pathname, sectionIds]);

  function jumpToSection(id: string) {
    if (location.pathname !== '/') {
      navigate(`/#${id}`);
      return;
    }
    const element = document.getElementById(id);
    if (!element) return;
    window.history.replaceState(null, '', `#${id}`);
    element.scrollIntoView({ behavior: 'auto', block: 'start' });
    if (isMobile) {
      setNavOpen(false);
    }
  }

  function logout() {
    const confirmed = window.confirm('Log out of Budget Tracker?');
    if (!confirmed) return;
    localStorage.removeItem('bt_logged_in');
    navigate('/login', { replace: true });
  }

  function toggleNav() {
    setNavOpen((prev) => {
      const next = !prev;
      if (!isMobile) {
        window.localStorage.setItem('bt_nav_open', next ? '1' : '0');
      }
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
        <nav>
          {WORKSPACE_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeId === section.id ? 'active' : ''}
              onClick={() => jumpToSection(section.id)}
            >
              {section.label}
            </button>
          ))}
          <button type="button" onClick={logout}>
            Logout
          </button>
        </nav>
      </aside>
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
        <Outlet />
      </main>
    </div>
  );
}
