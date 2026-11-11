import { cn } from '@/lib/cn';

export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <circle cx="16" cy="16" r="11" stroke="rgb(var(--cyan))" strokeOpacity="0.35" strokeWidth="1.1" />
      <ellipse cx="16" cy="16" rx="13.5" ry="5.2" transform="rotate(-28 16 16)" stroke="rgb(var(--violet))" strokeOpacity="0.55" strokeWidth="0.9" />
      <circle cx="16" cy="16" r="3.6" fill="rgb(var(--cyan))" />
      <circle cx="16" cy="16" r="6.2" fill="rgb(var(--cyan))" fillOpacity="0.12" />
      <circle cx="27.2" cy="10.2" r="1.7" fill="rgb(var(--violet))" />
      <circle cx="5.6" cy="21" r="1.25" fill="rgb(var(--ink))" />
      <circle cx="21.5" cy="26.4" r="1" fill="rgb(var(--cyan))" fillOpacity="0.8" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && <span className="font-display text-[0.95rem] font-semibold tracking-[0.22em] text-ink">ASTRION</span>}
    </span>
  );
}
