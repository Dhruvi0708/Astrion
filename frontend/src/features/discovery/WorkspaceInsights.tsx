import { GitBranch, Link2, Repeat, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useWorkspaceInsights } from '@/lib/api/hooks';

function List<T>({ items, empty, render }: { items: T[]; empty: string; render: (item: T, i: number) => React.ReactNode }) {
  if (!items.length) return <p className="text-xs text-ink-muted">{empty}</p>;
  return <ul className="space-y-2">{items.map(render)}</ul>;
}

/** Cross-investigation intelligence computed from this workspace's records (never other workspaces). */
export function WorkspaceInsights({ workspaceId }: { workspaceId: string }) {
  const q = useWorkspaceInsights(workspaceId);
  if (q.isPending) return <SkeletonRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (d.investigations === 0)
    return (
      <EmptyState
        icon={<Search size={18} />}
        title="No investigations yet"
        description="Insights connect what several investigations found. Run an investigation to start building them."
      />
    );
  return (
    <div className="space-y-4" data-testid="insights">
      <p className="text-xs text-ink-muted">
        Computed from {d.investigations} investigation(s) in this workspace ({d.method}). Every item links back to stored claims; nothing here is generated
        text.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Unnoticed connections" eyebrow="Two-step paths between findings of different investigations">
          <List
            items={d.connections}
            empty="No entity from one investigation connects to another investigation's findings through a shared entity yet."
            render={(c, i) => (
              <li key={i} className="rounded-md border border-line bg-deep/40 p-2.5 text-xs">
                <p className="flex items-center gap-1.5 text-ink">
                  <Link2 size={12} className="text-cyan" /> {c.path}
                </p>
                <p className="mt-1 text-2xs text-ink-faint">
                  {c.from}: {c.from_investigations.join(', ')} · {c.to}: {c.to_investigations.join(', ')}
                </p>
              </li>
            )}
          />
        </Panel>
        <Panel title="Shared across investigations" eyebrow="Bridging entities and corroborated relationships">
          <List
            items={d.bridging_entities}
            empty="No entity has been reached by more than one investigation."
            render={(e) => (
              <li key={e.entity_id} className="text-xs text-ink-muted">
                <span className="text-ink">{e.name}</span> — {e.investigations.join(', ')}
              </li>
            )}
          />
          {d.corroborated_relationships.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-line pt-3">
              {d.corroborated_relationships.map((r) => (
                <li key={r.relationship_id} className="text-xs text-ink-muted">
                  {r.source} <span className="text-cyan">{r.type.toLowerCase()}</span> {r.target} · corroborated by {r.investigations.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recurring patterns" eyebrow="Same relationship shape in several investigations">
          <List
            items={d.patterns}
            empty="No relationship pattern recurs across investigations yet."
            render={(p, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-ink-muted">
                <Repeat size={12} className="text-violet" /> {p.pattern} <Badge tone="neutral">{p.investigations} investigations</Badge>
              </li>
            )}
          />
        </Panel>
        <Panel title="How hypotheses evolved" eyebrow="Revisions and restatements across investigations">
          <List
            items={d.hypothesis_evolution}
            empty="No hypothesis has been revisited by a later investigation."
            render={(h, i) => (
              <li key={i} className="rounded-md border border-line bg-deep/40 p-2.5 text-xs" data-testid="evolution">
                <p className="text-ink-faint">
                  <GitBranch size={11} className="mr-1 inline" />
                  {h.from.investigation} → {h.to.investigation} ({h.link})
                </p>
                <p className="mt-1 text-ink-muted">{h.from.statement}</p>
                <p className="mt-1 text-ink">{h.to.statement}</p>
                {h.confidence_change != null && (
                  <p className="mt-1 text-2xs text-ink-faint">
                    {h.confidence_change >= 0 ? (
                      <TrendingUp size={11} className="inline text-verified" />
                    ) : (
                      <TrendingDown size={11} className="inline text-conflict" />
                    )}{' '}
                    confidence {h.from.confidence?.toFixed(2)} → {h.to.confidence?.toFixed(2)} · status {h.from.status} → {h.to.status}
                  </p>
                )}
              </li>
            )}
          />
        </Panel>
      </div>
      <Panel title="Knowledge gaps" eyebrow="Where the workspace's understanding is thin">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="eyebrow mb-1">Unanswered sub-questions</p>
            <List
              items={d.gaps.unanswered_sub_questions}
              empty="Every sub-question has evidence."
              render={(g, i) => (
                <li key={i} className="text-xs text-ink-muted">
                  {g.sub_question} <span className="text-ink-faint">({g.investigation})</span>
                </li>
              )}
            />
          </div>
          <div>
            <p className="eyebrow mb-1">Unresolved contradictions</p>
            <List
              items={d.gaps.unresolved_contradictions}
              empty="None open."
              render={(x) => (
                <li key={x.id} className="text-xs text-ink-muted">
                  “{x.a}” vs “{x.b}” <span className="text-ink-faint">({x.kind})</span>
                </li>
              )}
            />
          </div>
          <div>
            <p className="eyebrow mb-1">Open hypotheses</p>
            <List
              items={d.gaps.open_hypotheses}
              empty="None open."
              render={(h) => (
                <li key={h.id} className="text-xs text-ink-muted">
                  {h.statement}{' '}
                  <span className="text-ink-faint">
                    ({h.status}
                    {h.consensus ? `, ${h.consensus}` : ''})
                  </span>
                </li>
              )}
            />
          </div>
          <div>
            <p className="eyebrow mb-1">Weakly supported relationships</p>
            <List
              items={d.gaps.weakly_supported_relationships}
              empty="All relationships have more than one supporting claim."
              render={(r, i) => (
                <li key={i} className="text-xs text-ink-muted">
                  {r.source} <span className="text-cyan">{r.type.toLowerCase()}</span> {r.target}
                </li>
              )}
            />
          </div>
          <div>
            <p className="eyebrow mb-1">Entities with a single claim</p>
            <p className="text-xs text-ink-muted">{d.gaps.single_claim_entities.map((e) => e.name).join(', ') || 'None.'}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
