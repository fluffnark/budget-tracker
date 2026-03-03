import { useEffect, useMemo } from 'react';

import { AccountsPage } from './AccountsPage';
import { AnalyticsPage } from './AnalyticsPage';
import { CategoriesPage } from './CategoriesPage';
import { CategorizePage } from './CategorizePage';
import { DashboardPage } from './DashboardPage';
import { ExportPage } from './ExportPage';
import { ReportsPage } from './ReportsPage';
import { RulesPage } from './RulesPage';
import { SettingsPage } from './SettingsPage';
import { TransfersPage } from './TransfersPage';

export type WorkspaceSection = {
  id: string;
  label: string;
  content: JSX.Element;
};

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { id: 'workspace-dashboard', label: 'Dashboard', content: <DashboardPage /> },
  { id: 'workspace-accounts', label: 'Accounts', content: <AccountsPage /> },
  {
    id: 'workspace-transactions',
    label: 'Transactions',
    content: <CategorizePage />
  },
  { id: 'workspace-reports', label: 'Reports', content: <ReportsPage /> },
  { id: 'workspace-analytics', label: 'Analytics', content: <AnalyticsPage /> },
  {
    id: 'workspace-categories',
    label: 'Categories',
    content: <CategoriesPage />
  },
  { id: 'workspace-transfers', label: 'Transfers', content: <TransfersPage /> },
  { id: 'workspace-rules', label: 'Rules', content: <RulesPage /> },
  { id: 'workspace-export', label: 'Export', content: <ExportPage /> },
  { id: 'workspace-settings', label: 'Settings', content: <SettingsPage /> }
];

export function WorkspacePage() {
  const sectionIds = useMemo(
    () => WORKSPACE_SECTIONS.map((section) => section.id),
    []
  );

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash && sectionIds.includes(hash)) {
      const element = document.getElementById(hash);
      element?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [sectionIds]);

  function jumpTo(id: string) {
    const element = document.getElementById(id);
    if (!element) return;
    window.history.replaceState(null, '', `#${id}`);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="workspace">
      {WORKSPACE_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="workspace-panel">
          <div className="workspace-panel-head">
            <h2>{section.label}</h2>
            <button
              type="button"
              className="secondary"
              onClick={() => jumpTo(section.id)}
            >
              Jump to top
            </button>
          </div>
          {section.content}
        </section>
      ))}
    </div>
  );
}
