import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, Command, LogOut, Menu, MonitorSmartphone, Search, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Popover } from '@/components/ui/Popover';
import { useAuth } from '@/features/auth/store';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { useServiceHealth } from '@/lib/api/hooks';
import { useUi } from '@/stores/ui';
import { navByPath } from '../navigation';

function Breadcrumbs() {
  const { pathname } = useLocation();
  const { active } = useActiveWorkspace();
  const item = navByPath.get(pathname.replace(/\/$/, ''));
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-[0.8rem]">
        <li className="hidden truncate text-ink-faint sm:block">{active?.name ?? 'ASTRION'}</li>
        <li aria-hidden className="hidden text-ink-faint sm:block">
          <ChevronRight size={13} />
        </li>
        <li aria-current="page" className="truncate font-medium text-ink">
          {item?.label ?? 'Not found'}
        </li>
      </ol>
    </nav>
  );
}

function ConnectionStatus() {
  const health = useServiceHealth();
  if (health.isLoading) return <Badge tone="neutral">Connecting</Badge>;
  return health.isSuccess ? (
    <Badge tone="live" dot title={`API ${health.data.version} · ${health.data.environment}`}>
      API live
    </Badge>
  ) : (
    <Link to="/app/settings" className="rounded" title="Open system status">
      <Badge tone="offline" dot>
        API offline
      </Badge>
    </Link>
  );
}

function ProfileMenu() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const initials = (user?.display_name ?? '?')
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const signOut = async (everywhere: boolean) => {
    await logout({ everywhere });
    navigate('/login', { replace: true });
  };

  return (
    <Popover
      label="Profile"
      className="w-64"
      trigger={({ toggle, ...aria }) => (
        <button
          {...aria}
          onClick={toggle}
          aria-label="Profile menu"
          className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-raised font-display text-2xs font-semibold text-ink-muted hover:border-ink-faint"
        >
          {initials}
        </button>
      )}
    >
      {(close) => (
        <div className="p-1.5">
          <div className="px-2.5 pb-2.5 pt-2">
            <p className="truncate text-[0.8rem] font-medium text-ink">{user?.display_name}</p>
            <p className="truncate text-xs text-ink-muted">{user?.email}</p>
          </div>
          <div className="border-t border-line pt-1">
            <Link
              to="/app/settings"
              onClick={close}
              className="flex items-center gap-2 rounded px-2.5 py-1.5 text-[0.8rem] text-ink-muted hover:bg-raised hover:text-ink"
            >
              <Settings size={14} /> Settings & system status
            </Link>
            <Link to="/" onClick={close} className="flex items-center gap-2 rounded px-2.5 py-1.5 text-[0.8rem] text-ink-muted hover:bg-raised hover:text-ink">
              <ChevronRight size={14} /> Back to landing page
            </Link>
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button
              onClick={() => void signOut(false)}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[0.8rem] text-ink-muted hover:bg-raised hover:text-ink"
            >
              <LogOut size={14} /> Sign out
            </button>
            <button
              onClick={() => void signOut(true)}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[0.8rem] text-ink-muted hover:bg-raised hover:text-ink"
            >
              <MonitorSmartphone size={14} /> Sign out on all devices
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function Topbar() {
  const openCommand = useUi((s) => s.setCommandOpen);
  const openMobile = useUi((s) => s.setMobileNavOpen);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-line bg-abyss/85 px-4 backdrop-blur-md">
      <button
        onClick={() => openMobile(true)}
        aria-label="Open navigation"
        className="-ml-1 rounded p-1.5 text-ink-muted hover:bg-raised hover:text-ink lg:hidden"
      >
        <Menu size={18} />
      </button>
      <Breadcrumbs />
      <div className="flex-1" />
      <button
        onClick={() => openCommand(true)}
        className="flex h-8 items-center gap-2 rounded-md border border-line bg-deep/70 px-2.5 text-xs text-ink-faint transition-colors hover:border-line-strong hover:text-ink-muted sm:w-64"
        aria-label="Open command launcher"
      >
        <Search size={14} />
        <span className="hidden flex-1 text-left sm:block">Search or jump to…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-line-strong px-1 font-mono text-2xs sm:flex">
          {isMac ? <Command size={10} /> : 'Ctrl'} K
        </kbd>
      </button>
      <div className="hidden md:block">
        <ConnectionStatus />
      </div>
      <Popover
        label="Notifications"
        trigger={({ toggle, ...aria }) => (
          <button {...aria} onClick={toggle} aria-label="Notifications" className="rounded p-1.5 text-ink-muted hover:bg-raised hover:text-ink">
            <Bell size={16} />
          </button>
        )}
      >
        {() => (
          <div>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-display text-sm font-medium">Notifications</p>
            </div>
            <div className="px-4 py-6 text-center">
              <p className="text-[0.8rem] text-ink">You’re all caught up</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Ingestion, investigation and verification events will appear here once those pipelines ship.
              </p>
            </div>
          </div>
        )}
      </Popover>
      <ProfileMenu />
    </header>
  );
}
