import { Link } from 'react-router-dom';
import { ArrowRight, History } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, SkeletonRows } from '@/components/ui/States';
import { ProviderNotice } from '@/features/workbench/components/Activity';
import { INVESTIGATION_STATUS, ROLE } from '@/features/workbench/status';
import { useActiveWorkspace } from '@/features/workspaces/useActiveWorkspace';
import { useIntelligenceStatus, useInvestigations } from '@/lib/api/hooks';
import type { AgentRole } from '@/lib/api/types';
import { relativeTime } from '@/lib/format';

const PIPELINE: AgentRole[] = ['orchestrator', 'research', 'knowledge', 'hypothesis', 'contradiction', 'verification', 'synthesis'];

/** The deployed agents and the investigations they have actually run in this workspace. */
export function LiveEngine() {
  const status = useIntelligenceStatus();
  const { active } = useActiveWorkspace();
  const list = useInvestigations(active?.id ?? null);
  const configured = status.data?.configured;
  return (
    <section aria-labelledby="engine-title" className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="engine-title" className="eyebrow">
          Agent engine
        </h2>
        {status.data && (
          <Badge tone={!configured ? 'offline' : status.data.is_fixture ? 'sample' : 'live'} dot>
            {!configured ? 'No provider' : status.data.is_fixture ? 'Fixture provider (not AI)' : `${status.data.model}`}
          </Badge>
        )}
      </div>
      <ProviderNotice status={status.data} />
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {PIPELINE.map((role, i) => (
          <li key={role} className="rounded-lg border border-line bg-surface/60 p-3">
            <p className="font-mono text-2xs text-cyan">{String(i + 1).padStart(2, '0')}</p>
            <p className="mt-1 text-sm font-medium text-ink">{ROLE[role].label}</p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{ROLE[role].duty}.</p>
          </li>
        ))}
      </ol>
      <Panel
        title="Recent investigations"
        eyebrow="Execution history"
        actions={
          <Link to="/app/investigations" className="text-xs text-cyan hover:underline">
            All investigations
          </Link>
        }
      >
        {list.isPending && active ? (
          <SkeletonRows rows={3} />
        ) : list.data?.items.length ? (
          <ul className="divide-y divide-line">
            {list.data.items.slice(0, 6).map((inv) => (
              <li key={inv.id}>
                <Link to={`/app/investigations/${inv.id}`} className="group flex items-center gap-3 py-2.5">
                  <Badge tone={INVESTIGATION_STATUS[inv.status].tone} dot={INVESTIGATION_STATUS[inv.status].dot}>
                    {INVESTIGATION_STATUS[inv.status].label}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink group-hover:text-cyan">{inv.title}</span>
                  <span className="hidden text-2xs text-ink-faint sm:inline">
                    {inv.llm_provider ? `${inv.llm_provider}/${inv.llm_model}` : 'not run'} · {relativeTime(inv.updated_at)}
                  </span>
                  <ArrowRight size={13} className="text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<History size={17} />}
            title="No investigations in this workspace"
            description="Each run's agent executions, with inputs, outputs, model, tokens and hand-offs, appear in its workbench."
          />
        )}
      </Panel>
    </section>
  );
}
