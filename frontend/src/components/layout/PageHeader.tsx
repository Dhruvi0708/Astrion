import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Consistent header for every application environment. */
export function PageHeader({ eyebrow, title, description, badges, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2 text-cyan/80">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-[1.6rem] font-medium leading-tight tracking-tight text-ink md:text-[1.85rem]">{title}</h1>
          {badges}
        </div>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Standard padded page container. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1480px] px-4 py-6 md:px-8 md:py-8', className)}>{children}</div>;
}

/** Inline notice explaining the epistemic status of the content on a page. */
export function Notice({ tone = 'sample', children, className }: { tone?: 'sample' | 'planned'; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-[0.8rem] leading-relaxed',
        tone === 'sample' ? 'border-caution/25 bg-caution/[0.05] text-ink-muted' : 'border-dashed border-line-strong bg-deep/50 text-ink-muted',
        className,
      )}
    >
      <span aria-hidden className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', tone === 'sample' ? 'bg-caution' : 'bg-ink-faint')} />
      <div>{children}</div>
    </div>
  );
}
