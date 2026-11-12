import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { API_BASE_URL } from '@/lib/api/client';
import { useDependencyHealth, useServiceHealth } from '@/lib/api/hooks';
import type { DependencyStatus } from '@/lib/api/types';
import { usePreferences } from '@/stores/ui';

const DEP_TONE: Record<DependencyStatus, Tone> = { ok: 'live', unavailable: 'offline', not_configured: 'planned' };
const DEP_LABEL: Record<DependencyStatus, string> = { ok: 'Connected', unavailable: 'Unavailable', not_configured: 'Not configured' };

function StatusRow({ name, role, query }: { name: string; role: string; query: ReturnType<typeof useDependencyHealth> | ReturnType<typeof useServiceHealth> }) {
  const data = query.data as { status: string; latency_ms?: number | null; detail?: string | null; version?: string } | undefined;
  let badge: React.ReactNode;
  if (query.isLoading) badge = <Badge>Checking…</Badge>;
  else if (query.isError)
    badge = (
      <Badge tone="offline" dot>
        Unreachable
      </Badge>
    );
  else if (data && 'latency_ms' in data)
    badge = (
      <Badge tone={DEP_TONE[data.status as DependencyStatus]} dot>
        {DEP_LABEL[data.status as DependencyStatus]}
      </Badge>
    );
  else
    badge = (
      <Badge tone="live" dot>
        Online
      </Badge>
    );

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[0.85rem] text-ink">{name}</p>
        <p className="text-2xs text-ink-faint">{role}</p>
        {query.isError && <p className="mt-1 text-2xs text-conflict">{(query.error as Error).message}</p>}
        {data?.detail && <p className="mt-1 font-mono text-2xs text-ink-faint">{data.detail}</p>}
      </div>
      <div className="flex items-center gap-3">
        {data?.latency_ms != null && <span className="font-mono text-2xs text-ink-faint">{data.latency_ms.toFixed(1)} ms</span>}
        {data?.version && <span className="font-mono text-2xs text-ink-faint">v{data.version}</span>}
        {badge}
      </div>
    </li>
  );
}

export default function SettingsPage() {
  const api = useServiceHealth();
  const pg = useDependencyHealth('postgres');
  const neo = useDependencyHealth('neo4j');
  const prefs = usePreferences();
  useEffect(() => {
    document.title = 'Settings · ASTRION';
  }, []);

  return (
    <Page className="max-w-[1100px]">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Live system status for the ASTRION backend and its dependencies, and preferences stored in this browser."
      />

      <Panel
        title="System status"
        eyebrow="Live health checks"
        className="mt-6"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              api.refetch();
              pg.refetch();
              neo.refetch();
            }}
          >
            <RefreshCw size={13} /> Re-check
          </Button>
        }
      >
        <ul className="divide-y divide-line">
          <StatusRow name="ASTRION API" role={`FastAPI · ${API_BASE_URL}/v1/health`} query={api} />
          <StatusRow name="PostgreSQL" role="Application and relational metadata" query={pg} />
          <StatusRow name="Neo4j" role="Knowledge-graph relationships and traversal" query={neo} />
        </ul>
        <p className="mt-2 text-2xs leading-relaxed text-ink-faint">
          Results come directly from the backend’s health endpoints. A dependency is only shown as connected when the backend has verified the connection.
        </p>
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel title="Preferences" eyebrow="This browser">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[0.85rem] text-ink" id="pref-motion">
                  Reduce motion
                </p>
                <p className="text-2xs text-ink-faint">Slows the 3D universe and disables decorative animation.</p>
              </div>
              <button
                role="switch"
                aria-checked={prefs.reduceMotion}
                aria-labelledby="pref-motion"
                onClick={() => prefs.setReduceMotion(!prefs.reduceMotion)}
                className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${prefs.reduceMotion ? 'border-cyan/60 bg-cyan/25' : 'border-line-strong bg-deep'}`}
              >
                <span
                  className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] ${prefs.reduceMotion ? 'left-[18px] bg-cyan' : 'left-0.5 bg-ink-faint'}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[0.85rem] text-ink">Graph labels</p>
                <p className="text-2xs text-ink-faint">Default label density in the Universe Explorer.</p>
              </div>
              <Segmented
                label="Graph label density"
                value={prefs.graphLabels}
                onChange={prefs.setGraphLabels}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'all', label: 'All' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </div>
          </div>
        </Panel>
        <Panel title="About this build" eyebrow="Phase 1 · Foundation">
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-xs">
            <dt className="text-ink-faint">Frontend</dt>
            <dd className="text-ink-muted">React 18 · Vite · Three.js</dd>
            <dt className="text-ink-faint">API</dt>
            <dd className="text-ink-muted">{api.data ? `v${api.data.version} · ${api.data.environment}` : 'Not connected'}</dd>
            <dt className="text-ink-faint">Authentication</dt>
            <dd className="text-ink-muted">Not yet implemented (single-user dev mode)</dd>
            <dt className="text-ink-faint">AI providers</dt>
            <dd className="text-ink-muted">Configured server-side only; no keys in the browser</dd>
          </dl>
        </Panel>
      </div>
    </Page>
  );
}
