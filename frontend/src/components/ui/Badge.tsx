import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Epistemic status labels. These are central to ASTRION's honesty contract:
 * every surface must make clear whether content is sample, planned, live, unverified or verified.
 */
export type Tone = 'neutral' | 'sample' | 'planned' | 'live' | 'offline' | 'verified' | 'unverified' | 'hypothesis' | 'conflict' | 'gap' | 'cyan';

const tones: Record<Tone, string> = {
  neutral: 'border-line-strong text-ink-muted bg-raised/50',
  sample: 'border-caution/35 text-caution bg-caution/[0.07]',
  planned: 'border-ink-faint/40 text-ink-muted bg-transparent border-dashed',
  live: 'border-verified/35 text-verified bg-verified/[0.07]',
  offline: 'border-conflict/35 text-conflict bg-conflict/[0.07]',
  verified: 'border-verified/35 text-verified bg-verified/[0.07]',
  unverified: 'border-caution/35 text-caution bg-transparent',
  hypothesis: 'border-violet/40 text-violet bg-violet/[0.08]',
  conflict: 'border-conflict/35 text-conflict bg-conflict/[0.07]',
  gap: 'border-gap/35 text-gap bg-gap/[0.07]',
  cyan: 'border-cyan/35 text-cyan bg-cyan/[0.07]',
};

const dots: Partial<Record<Tone, string>> = {
  live: 'bg-verified animate-pulse-dot',
  offline: 'bg-conflict',
  sample: 'bg-caution',
  hypothesis: 'bg-violet',
  verified: 'bg-verified',
  conflict: 'bg-conflict',
  gap: 'bg-gap',
  cyan: 'bg-cyan',
};

export function Badge({ tone = 'neutral', children, dot, className, title }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-[4px] border px-1.5 text-2xs font-medium uppercase tracking-[0.08em]',
        tones[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dots[tone] ?? 'bg-ink-muted')} />}
      {children}
    </span>
  );
}

export const SampleBadge = ({ label = 'Sample data' }: { label?: string }) => (
  <Badge tone="sample" dot title="Illustrative content. Not produced by ASTRION and not a real finding.">
    {label}
  </Badge>
);

export const PlannedBadge = ({ label = 'Planned' }: { label?: string }) => (
  <Badge tone="planned" title="This capability is part of the roadmap and is not implemented yet.">
    {label}
  </Badge>
);
