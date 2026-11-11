import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Badge, PlannedBadge, SampleBadge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/States';
import { Notice, Page, PageHeader } from '@/components/layout/PageHeader';
import { AGENTS, agentByRole, SAMPLE_SEQUENCE, type AgentRole } from '@/data/sample/agents';
import { STATUS_META } from '@/data/sample/discoveries';
import { cn } from '@/lib/cn';
import { AgentWorkflow } from './components/AgentWorkflow';
import { SampleWalkthrough } from './components/SampleWalkthrough';

/** Handoff counts between roles, computed from the sample sequence. */
function HandoffMatrix() {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of SAMPLE_SEQUENCE) if (s.handoffTo) m.set(`${s.role}>${s.handoffTo}`, (m.get(`${s.role}>${s.handoffTo}`) ?? 0) + 1);
    return m;
  }, []);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs">
        <caption className="sr-only">Handoffs between agent roles in the sample sequence. Rows send, columns receive.</caption>
        <thead>
          <tr>
            <th scope="col" className="p-1 text-left text-2xs font-normal text-ink-faint">
              From ↓ / To →
            </th>
            {AGENTS.map((a) => (
              <th key={a.role} scope="col" className="p-1 text-2xs font-medium" style={{ color: a.color }}>
                {a.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AGENTS.map((from) => (
            <tr key={from.role}>
              <th scope="row" className="whitespace-nowrap p-1 text-left text-2xs font-medium" style={{ color: from.color }}>
                {from.name}
              </th>
              {AGENTS.map((to) => {
                const n = counts.get(`${from.role}>${to.role}`) ?? 0;
                return (
                  <td key={to.role} className={cn('h-9 rounded text-center font-mono', n ? 'bg-cyan/[0.12] text-cyan' : from.role === to.role ? 'bg-transparent text-ink-faint/40' : 'bg-deep text-ink-faint')}>
                    {from.role === to.role ? '—' : n || '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function IntelligenceNetworkPage() {
  const [focus, setFocus] = useState<AgentRole>('inquirer');
  const agent = agentByRole[focus];
  useEffect(() => {
    document.title = 'Intelligence Network · ASTRION';
  }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="Intelligence Network"
        title="Intelligence Network"
        badges={<PlannedBadge label="Engine planned" />}
        description="The interface for ASTRION’s multi-agent investigation system: roles, handoffs, execution history and verification status."
      />
      <Notice tone="planned" className="mt-5">
        No agents are deployed in Phase 1. Role definitions describe the planned design; the walkthrough is a hand-written sample. Agent executions will be recorded in the <code className="font-mono text-ink">agent_executions</code> table, which already exists in the database schema.
      </Notice>

      <section aria-labelledby="roles-title" className="mt-8">
        <h2 id="roles-title" className="eyebrow mb-3">
          Agent roles
        </h2>
        <AgentWorkflow activeRole={focus} onSelect={setFocus} />
        <div className="panel mt-3 grid gap-4 p-5 md:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <p className="eyebrow">Responsibility</p>
            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink">{agent.responsibility}</p>
          </div>
          <div>
            <p className="eyebrow">Inputs</p>
            <p className="mt-1.5 text-[0.85rem] text-ink-muted">{agent.inputs}</p>
          </div>
          <div>
            <p className="eyebrow">Outputs</p>
            <p className="mt-1.5 text-[0.85rem] text-ink-muted">{agent.outputs}</p>
          </div>
          <div className="flex items-start md:justify-end">
            <Badge tone="planned">Not deployed</Badge>
          </div>
        </div>
      </section>

      <section aria-labelledby="walk-title" className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="walk-title" className="eyebrow">
            Investigation workflow · activity
          </h2>
        </div>
        <SampleWalkthrough autoPlay={false} dense showWorkflow={false} />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Handoffs" eyebrow="Communication" actions={<SampleBadge label="From sample sequence" />}>
          <HandoffMatrix />
          <p className="mt-3 text-2xs text-ink-faint">Counts are computed from the illustrative walkthrough above, not from live executions.</p>
        </Panel>
        <Panel title="Verification statuses" eyebrow="Epistemic states">
          <ul className="space-y-2.5">
            {Object.entries(STATUS_META).map(([key, s]) => (
              <li key={key} className="flex items-start gap-3">
                <Badge tone={s.tone} className="w-24 justify-center">
                  {s.label}
                </Badge>
                <span className="text-xs leading-relaxed text-ink-muted">{s.description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-2xs leading-relaxed text-ink-faint">Only a Verifier, with evidence attached, can move an item to Verified. AI-generated hypotheses always start as Unverified.</p>
        </Panel>
      </div>

      <Panel title="Execution history" eyebrow="Records" className="mt-4">
        <EmptyState
          icon={<History size={17} />}
          title="No agent executions recorded"
          description="Executions will appear here with inputs, outputs, model, timing and parent handoff once the agent engine is deployed."
        />
      </Panel>
    </Page>
  );
}
