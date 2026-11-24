import { FlaskConical, FolderOpen, LayoutDashboard, Library, Network, Orbit, Search, Settings, Sparkles, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  group: 'environments' | 'workspace';
}

/** Single source of truth for application navigation (sidebar, mobile nav, command palette, breadcrumbs). */
export const NAV_ITEMS: NavItem[] = [
  {
    to: '/app/overview',
    label: 'Dashboard',
    short: 'Dashboard',
    description: 'Workspace state: investigations, knowledge and activity',
    icon: LayoutDashboard,
    group: 'environments',
  },
  { to: '/app/universe', label: 'Universe Explorer', short: 'Universe', description: 'Explore the knowledge graph', icon: Orbit, group: 'environments' },
  {
    to: '/app/investigations',
    label: 'Investigation Room',
    short: 'Investigate',
    description: 'Questions, claims, evidence and findings',
    icon: Search,
    group: 'environments',
  },
  {
    to: '/app/explorer',
    label: 'Intelligence Explorer',
    short: 'Explore',
    description: 'Entities, hypotheses, contradictions and evidence',
    icon: Library,
    group: 'environments',
  },
  {
    to: '/app/intelligence',
    label: 'Intelligence Network',
    short: 'Agents',
    description: 'Multi-agent investigation workflow',
    icon: Network,
    group: 'environments',
  },
  {
    to: '/app/discovery',
    label: 'Discovery Laboratory',
    short: 'Discovery',
    description: 'Hypotheses, contradictions and gaps',
    icon: Sparkles,
    group: 'environments',
  },
  {
    to: '/app/simulation',
    label: 'Simulation Laboratory',
    short: 'Simulate',
    description: 'What-if scenarios and assumptions',
    icon: FlaskConical,
    group: 'environments',
  },
  {
    to: '/app/sources',
    label: 'Sources',
    short: 'Sources',
    description: 'Upload documents, extract text, see what was found',
    icon: FolderOpen,
    group: 'workspace',
  },
  { to: '/app/settings', label: 'Settings', short: 'Settings', description: 'System status and preferences', icon: Settings, group: 'workspace' },
];

export const navByPath = new Map(NAV_ITEMS.map((item) => [item.to, item]));
