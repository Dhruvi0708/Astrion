import { NavLink, Link } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/cn';
import { usePreferences } from '@/stores/ui';
import { NAV_ITEMS } from '../navigation';
import { WorkspaceSelector } from './WorkspaceSelector';

export function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const groups = [
    { id: 'environments', label: 'Environments' },
    { id: 'workspace', label: 'Workspace' },
  ] as const;
  return (
    <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
      {groups.map((group) => (
        <div key={group.id}>
          {!collapsed && <p className="eyebrow mb-1.5 px-2.5">{group.label}</p>}
          <ul className="space-y-0.5">
            {NAV_ITEMS.filter((i) => i.group === group.id).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8rem] transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive ? 'bg-raised text-ink' : 'text-ink-muted hover:bg-raised/60 hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute left-0 top-1.5 h-5 w-[2px] rounded-full bg-cyan shadow-[0_0_10px_rgb(var(--cyan))]" />}
                      <item.icon size={15} strokeWidth={1.75} className={cn(isActive ? 'text-cyan' : 'text-ink-faint group-hover:text-ink-muted')} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const collapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggle = usePreferences((s) => s.toggleSidebar);
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-abyss/95 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[60px]' : 'w-[236px]',
      )}
    >
      <div className={cn('flex h-[52px] items-center border-b border-line px-4', collapsed && 'justify-center px-0')}>
        <Link to="/" aria-label="ASTRION home" className="rounded">
          <Logo compact={collapsed} />
        </Link>
      </div>
      <div className="px-2.5 pt-3">
        <WorkspaceSelector collapsed={collapsed} />
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className="border-t border-line p-2.5">
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-xs text-ink-faint hover:bg-raised/60 hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}
