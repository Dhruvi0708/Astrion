import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-4 grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-deep text-ink-muted">{icon}</div>}
      <p className="font-display text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[0.8rem] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const apiError = error instanceof ApiError ? error : null;
  const unavailable = apiError?.isUnavailable ?? false;
  const title = unavailable ? 'Backend unavailable' : 'Something went wrong';
  const description = unavailable
    ? 'The ASTRION API could not be reached. Start the backend (see README) and retry.'
    : (apiError?.message ?? (error instanceof Error ? error.message : 'An unexpected error occurred.'));
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10', className)}>
      <div className="grid h-10 w-10 place-items-center rounded-full border border-conflict/30 bg-conflict/[0.06] text-conflict">
        {unavailable ? <WifiOff size={17} /> : <AlertTriangle size={17} />}
      </div>
      <div>
        <p className="font-display text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-sm text-[0.8rem] leading-relaxed text-ink-muted">{description}</p>
        {apiError?.requestId && <p className="mt-1 font-mono text-2xs text-ink-faint">request {apiError.requestId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw size={13} /> Retry
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded bg-[linear-gradient(90deg,rgb(var(--raised))_0%,rgb(var(--line))_40%,rgb(var(--raised))_80%)] bg-[length:800px_100%]',
        className,
      )}
    />
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
