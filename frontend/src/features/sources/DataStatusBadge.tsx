import { Badge } from '@/components/ui/Badge';
import { useServiceHealth } from '@/lib/api/hooks';

/**
 * Reports whether the data on screen is live. It combines the API health check with the page's
 * own query state, so it can never claim "live" while the backend is unreachable.
 */
export function DataStatusBadge({ queryFailed, loading }: { queryFailed?: boolean; loading?: boolean }) {
  const health = useServiceHealth();
  if (health.isLoading || (loading && !health.isError)) return <Badge tone="neutral">Checking…</Badge>;
  if (health.isError || queryFailed) {
    return (
      <Badge tone="offline" dot title="The ASTRION API is unreachable. Data on this page may be missing or stale.">
        Backend offline
      </Badge>
    );
  }
  return (
    <Badge tone="live" dot title={`Connected to API ${health.data?.version ?? ''}`.trim()}>
      Live data
    </Badge>
  );
}
