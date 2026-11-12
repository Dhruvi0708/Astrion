import { Check, ChevronsUpDown, Plus, WifiOff } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';

export function WorkspaceSelector({ collapsed }: { collapsed?: boolean }) {
  const { workspaces, active, isLoading, isError, setActiveId, refetch } = useActiveWorkspace();
  const openCreate = useUi((s) => s.setCreateWorkspaceOpen);

  const label = isLoading ? 'Loading…' : isError ? 'Backend offline' : (active?.name ?? 'No workspace yet');
  const initial = (active?.name ?? 'A').charAt(0).toUpperCase();

  return (
    <Popover
      label="Select workspace"
      align="start"
      className="w-64"
      trigger={({ toggle, ...aria }) => (
        <button
          {...aria}
          onClick={toggle}
          title={collapsed ? label : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md border border-line bg-deep/70 p-1.5 text-left transition-colors hover:border-line-strong',
            collapsed && 'justify-center',
          )}
        >
          <span
            className={cn(
              'grid h-7 w-7 shrink-0 place-items-center rounded-[5px] font-display text-xs font-semibold',
              isError ? 'bg-conflict/10 text-conflict' : 'bg-cyan/10 text-cyan',
            )}
          >
            {isError ? <WifiOff size={13} /> : initial}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-2xs uppercase tracking-[0.12em] text-ink-faint">Workspace</span>
                <span className="block truncate text-[0.8rem] font-medium text-ink">{label}</span>
              </span>
              <ChevronsUpDown size={14} className="shrink-0 text-ink-faint" />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="p-1.5">
          <p className="eyebrow px-2 pb-1.5 pt-1">Workspaces</p>
          {isError && (
            <div className="px-2 py-2 text-xs text-ink-muted">
              The API is unreachable, so workspaces can’t be listed.{' '}
              <button className="text-cyan hover:underline" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          )}
          {!isError && !isLoading && workspaces.length === 0 && <p className="px-2 py-2 text-xs text-ink-muted">No workspaces yet. Create the first one.</p>}
          <ul className="max-h-64 overflow-y-auto">
            {workspaces.map((ws) => (
              <li key={ws.id}>
                <button
                  onClick={() => {
                    setActiveId(ws.id);
                    close();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[0.8rem] text-ink-muted hover:bg-raised hover:text-ink"
                >
                  <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                  <span className="font-mono text-2xs text-ink-faint">{ws.source_count}</span>
                  {ws.id === active?.id && <Check size={13} className="text-cyan" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line pt-1">
            <button
              onClick={() => {
                close();
                openCreate(true);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[0.8rem] text-ink-muted hover:bg-raised hover:text-ink"
            >
              <Plus size={14} /> Create workspace
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
