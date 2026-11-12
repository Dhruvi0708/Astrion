import { Fragment } from 'react';
import { motion } from 'framer-motion';
import { AGENTS, type AgentRole } from '@/data/sample/agents';
import { cn } from '@/lib/cn';

/**
 * Horizontal (desktop) / vertical (mobile) handoff diagram of the five planned agent roles.
 * `activeRole` and `nextRole` highlight the current handoff in a walkthrough.
 */
export function AgentWorkflow({
  activeRole,
  nextRole,
  onSelect,
  className,
}: {
  activeRole?: AgentRole | null;
  nextRole?: AgentRole | null;
  onSelect?: (role: AgentRole) => void;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-0', className)} aria-label="Agent handoff sequence">
      {AGENTS.map((agent, i) => {
        const active = agent.role === activeRole;
        const next = agent.role === nextRole;
        const Wrapper = onSelect ? 'button' : 'div';
        return (
          <Fragment key={agent.role}>
            <li className="md:flex-1">
              <Wrapper
                {...(onSelect ? { onClick: () => onSelect(agent.role), 'aria-pressed': active } : {})}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-lg border bg-surface/70 p-3 text-left transition-[border-color,background-color,box-shadow] duration-300 md:flex-col md:items-center md:px-2 md:py-4 md:text-center',
                  active ? 'border-transparent bg-raised' : next ? 'border-dashed border-line-strong' : 'border-line',
                  onSelect && 'hover:border-line-strong',
                )}
                style={active ? { boxShadow: `0 0 0 1px ${agent.color}88, 0 0 28px -8px ${agent.color}` } : undefined}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border"
                  style={{ borderColor: `${agent.color}55`, background: `${agent.color}12`, color: agent.color }}
                >
                  <agent.icon size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[0.85rem] font-medium text-ink">{agent.name}</span>
                  <span className="block text-2xs text-ink-faint md:mt-0.5">{agent.outputs}</span>
                </span>
              </Wrapper>
            </li>
            {i < AGENTS.length - 1 && (
              <li aria-hidden className="relative mx-auto h-5 w-px bg-line md:mx-0 md:h-px md:w-8 md:flex-none">
                {(agent.role === activeRole && AGENTS[i + 1].role === nextRole) || (agent.role === nextRole && AGENTS[i + 1].role === activeRole) ? (
                  <motion.span
                    className="absolute inset-0 bg-cyan shadow-[0_0_10px_rgb(var(--cyan))]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.35, 1, 0.35] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ) : null}
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
