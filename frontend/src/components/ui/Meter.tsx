import { cn } from '@/lib/cn';

/** Compact horizontal confidence meter. Always pair with a textual label stating whether the value is sample. */
export function Meter({ value, tone = 'cyan', label, className }: { value: number; tone?: 'cyan' | 'violet' | 'verified' | 'caution' | 'conflict'; label: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const fill = { cyan: 'bg-cyan', violet: 'bg-violet', verified: 'bg-verified', caution: 'bg-caution', conflict: 'bg-conflict' }[tone];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
        <div className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-2xs text-ink-muted">{pct}%</span>
    </div>
  );
}
