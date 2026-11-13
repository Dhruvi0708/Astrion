import type { Tone } from '@/components/ui/Badge';
import type { AgentRole, ExecutionStatus, InvestigationStatus, Verdict } from '@/lib/api/types';

/** Labels for states the backend records. Nothing here is inferred on the client. */
export const INVESTIGATION_STATUS: Record<InvestigationStatus, { label: string; tone: Tone; dot?: boolean }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'cyan', dot: true },
  running: { label: 'Running', tone: 'live', dot: true },
  cancelling: { label: 'Cancelling', tone: 'unverified', dot: true },
  completed: { label: 'Completed', tone: 'verified' },
  failed: { label: 'Failed', tone: 'offline' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'unverified' },
};

export const EXECUTION_STATUS: Record<ExecutionStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'planned' },
  running: { label: 'Running', tone: 'live' },
  succeeded: { label: 'Succeeded', tone: 'verified' },
  failed: { label: 'Failed', tone: 'offline' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export const ROLE: Record<AgentRole, { label: string; duty: string }> = {
  system: { label: 'System', duty: 'Deterministic steps: text extraction and graph sync' },
  orchestrator: { label: 'Orchestrator', duty: 'Decomposes the question into sub-questions and evidence needs' },
  research: { label: 'Research', duty: 'Extracts entities, claims and relationships with verbatim quotes' },
  knowledge: { label: 'Knowledge', duty: 'Resolves duplicates and merges findings into the persistent graph' },
  hypothesis: { label: 'Hypothesis', duty: 'Proposes testable explanations grounded in cited claims' },
  contradiction: { label: 'Contradiction', duty: 'Finds conflicting claims and classifies the conflict' },
  verification: { label: 'Verification', duty: 'Checks hypotheses and conflicts against their evidence' },
  synthesis: { label: 'Synthesis', duty: 'Writes the cited report and its open questions' },
};

/** Stage keys returned in `progress`, in pipeline order, with what the UI calls them. */
export const STAGE_LABEL: Record<string, string> = {
  ingest: 'Ingest',
  orchestrator: 'Plan',
  research: 'Research',
  knowledge: 'Knowledge',
  'graph_sync:knowledge': 'Graph sync',
  hypothesis: 'Hypotheses',
  contradiction: 'Contradictions',
  verification: 'Verification',
  synthesis: 'Synthesis',
  'graph_sync:final': 'Final sync',
};

export const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  supported: { label: 'Supported', tone: 'verified' },
  partially_supported: { label: 'Partially supported', tone: 'cyan' },
  unsupported: { label: 'Unsupported', tone: 'offline' },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'unverified' },
  contradicted: { label: 'Contradicted', tone: 'conflict' },
};

export const ANSWER_STATUS = {
  answered: { label: 'Answered', tone: 'verified' as Tone },
  partially_answered: { label: 'Partially answered', tone: 'cyan' as Tone },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'unverified' as Tone },
};

export function stageName(stepKey: string | null): string {
  if (!stepKey) return 'step';
  const name = stepKey.replace(/^r\d+:/, '');
  return name;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return 'not priced';
  if (usd === 0) return '$0.00';
  return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`;
}
