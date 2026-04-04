import { AnalyticsPage } from '../pages/AnalyticsPage';
import { BudgetPage } from '../pages/BudgetPage';
import { CategoriesPage } from '../pages/CategoriesPage';
import { CategorizePage } from '../pages/CategorizePage';
import { DashboardPage } from '../pages/DashboardPage';
import { ExportPage } from '../pages/ExportPage';
import { RulesPage } from '../pages/RulesPage';
import { SettingsPage } from '../pages/SettingsPage';

export type WorkspaceSectionGroup = 'track' | 'insights' | 'automation';

export type WorkspaceSection = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  group: WorkspaceSectionGroup;
  render: () => JSX.Element;
};

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  {
    id: 'dashboard',
    label: 'Home',
    shortLabel: 'Home',
    description: 'Live snapshot of balances, account health, and monthly movement.',
    group: 'track',
    render: () => <DashboardPage />
  },
  {
    id: 'transactions',
    label: 'Transactions',
    shortLabel: 'Txns',
    description: 'Categorize transactions, review confidence, and tune filters.',
    group: 'track',
    render: () => <CategorizePage />
  },
  {
    id: 'budget',
    label: 'Budget',
    shortLabel: 'Budget',
    description: 'Set the monthly plan, balance allocations, and track family/category budgets.',
    group: 'track',
    render: () => <BudgetPage />
  },
  {
    id: 'analytics',
    label: 'Insights',
    shortLabel: 'Insights',
    description: 'Reports, merchant history, cash flow, and projection tools in one place.',
    group: 'insights',
    render: () => <AnalyticsPage />
  },
  {
    id: 'categories',
    label: 'Categories',
    shortLabel: 'Categories',
    description: 'Maintain taxonomy and uncategorized review hygiene.',
    group: 'automation',
    render: () => <CategoriesPage />
  },
  {
    id: 'rules',
    label: 'Rules',
    shortLabel: 'Rules',
    description: 'Automate categorization and reduce recurring manual cleanup.',
    group: 'automation',
    render: () => <RulesPage />
  },
  {
    id: 'export',
    label: 'Export',
    shortLabel: 'Export',
    description: 'Generate privacy-scrubbed LLM datasets and prompt packs.',
    group: 'automation',
    render: () => <ExportPage />
  },
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    description: 'Configure sync behavior, privacy defaults, and app controls.',
    group: 'automation',
    render: () => <SettingsPage />
  }
];

export const WORKSPACE_DEFAULT_SECTION_ID = 'dashboard';

export const WORKSPACE_GROUP_LABELS: Record<WorkspaceSectionGroup, string> = {
  track: 'Track',
  insights: 'Insights',
  automation: 'Automation'
};

export const PRIMARY_MOBILE_SECTION_IDS = [
  'dashboard',
  'budget',
  'transactions',
  'analytics'
];

export function getWorkspaceSection(id: string | null | undefined) {
  if (id === 'reports') {
    return WORKSPACE_SECTIONS.find((section) => section.id === 'analytics') ?? WORKSPACE_SECTIONS[0];
  }
  if (!id) return WORKSPACE_SECTIONS[0];
  return (
    WORKSPACE_SECTIONS.find((section) => section.id === id) ??
    WORKSPACE_SECTIONS[0]
  );
}
