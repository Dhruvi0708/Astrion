import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'aside' | 'article';
  id?: string;
}

/** Bordered surface used for every grouped region in the application. */
export function Panel({ title, eyebrow, actions, children, className, bodyClassName, as: Tag = 'section', id }: PanelProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Tag id={id} aria-labelledby={title ? headingId : undefined} className={cn('panel flex min-w-0 flex-col', className)}>
      {(title || actions || eyebrow) && (
        <header className="flex min-h-[44px] items-center justify-between gap-3 border-b border-line/80 px-4 py-2.5">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-0.5">{eyebrow}</div>}
            {title && (
              <h2 id={headingId} className="truncate font-display text-[0.9rem] font-medium text-ink">
                {title}
              </h2>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </Tag>
  );
}
