import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes, routerFuture } from '@/app/router';
import { useAuth } from '@/features/auth/store';
import type { AgentExecution, InvestigationDetail, InvestigationReport, WorkspaceGraph } from '@/lib/api/types';
import { CLAIM_DEPTH, layoutGraph } from './graph/layout3d';

const WS = 'ws-1';
const INV = 'inv-1';

const graph: WorkspaceGraph = {
  source: 'postgres',
  fallback_reason: 'Neo4j is not configured.',
  nodes: [
    { key: 'ent:a', kind: 'entity', label: 'Ocean warming', entity_type: 'concept', entity_id: 'a', mention_count: 3, aliases: [] },
    { key: 'ent:b', kind: 'entity', label: 'Coral bleaching', entity_type: 'event', entity_id: 'b', mention_count: 1, aliases: [] },
    { key: 'clm:c1', kind: 'claim', label: 'Warming increases bleaching.', claim_id: 'c1', claim_kind: 'explicit' },
  ],
  edges: [
    { key: 'r1', type: 'CAUSES', source: 'ent:a', target: 'ent:b', support_count: 1, claim_ids: ['c1'], confidence: null },
    { key: 'about:c1', type: 'ABOUT', source: 'clm:c1', target: 'ent:a', support_count: 1, claim_ids: ['c1'], confidence: null },
    { key: 'dangling', type: 'CAUSES', source: 'ent:a', target: 'ent:missing', support_count: 1, claim_ids: [], confidence: null },
  ],
};

describe('layoutGraph', () => {
  it('places claims on the plane behind entities, deterministically', () => {
    const a = layoutGraph(graph);
    const b = layoutGraph(graph);
    expect(a.nodes.map((n) => n.position)).toEqual(b.nodes.map((n) => n.position));
    expect(a.byKey.get('ent:a')!.position[2]).toBe(0);
    expect(a.byKey.get('clm:c1')!.position[2]).toBe(CLAIM_DEPTH);
    for (const n of a.nodes) expect(n.position.every(Number.isFinite)).toBe(true);
    expect(a.byKey.get('ent:a')!.radius).toBeGreaterThan(a.byKey.get('ent:b')!.radius); // more mentions → bigger
    expect([...a.neighbours.get('ent:a')!]).toEqual(expect.arrayContaining(['ent:b', 'clm:c1']));
    expect(a.neighbours.has('ent:missing')).toBe(false); // dangling edges are ignored
  });
});

/* ---------------------------------------------------------------- page tests */

const base: InvestigationDetail = {
  id: INV,
  workspace_id: WS,
  title: 'Warming and bleaching',
  question: 'Does ocean warming increase coral bleaching?',
  status: 'completed',
  document_ids: [],
  summary: null,
  error: null,
  run_count: 1,
  started_at: '2026-11-12T10:00:00Z',
  finished_at: '2026-11-12T10:01:00Z',
  llm_provider: 'fixture',
  llm_model: 'astrion-fixture-v1',
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  created_at: '2026-11-12T09:00:00Z',
  updated_at: '2026-11-12T10:01:00Z',
  plan: {
    objective: 'o',
    scope_notes: '',
    sub_questions: [{ id: 'Q1', question: 'Sub question one', rationale: '' }],
    key_terms: [],
    evidence_needs: [],
    initial_assessment: '',
  },
  progress: [
    { stage: 'ingest', role: 'system', status: 'succeeded', steps: 1, succeeded: 1, failed: 0, summary: '2 of 2 documents' },
    { stage: 'orchestrator', role: 'orchestrator', status: 'succeeded', steps: 1, succeeded: 1, failed: 0, summary: null },
    { stage: 'graph_sync:knowledge', role: 'system', status: 'skipped', steps: 1, succeeded: 0, failed: 0, summary: 'Neo4j is not configured' },
  ],
  counts: { claims: 1, hypotheses: 0, contradictions: 0, executions: 2 },
  can_start: true,
  can_resume: false,
  can_cancel: false,
};

const execution = (over: Partial<AgentExecution>): AgentExecution => ({
  id: 'e1',
  step_key: 'r1:orchestrator',
  agent_role: 'orchestrator',
  status: 'succeeded',
  attempt: 1,
  parent_execution_id: null,
  depends_on: ['r1:ingest'],
  provider: 'fixture',
  model_requested: 'astrion-fixture-v1',
  model: 'astrion-fixture-v1',
  provider_request_id: null,
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  duration_ms: 12,
  summary: '1 sub-question defined.',
  error: null,
  started_at: null,
  finished_at: null,
  input: { question: 'q' },
  output: { result: { objective: 'o' }, notes: ['C2: quote not found verbatim in P1; evidence dropped.'] },
  ...over,
});

const report: InvestigationReport = {
  id: 'rep',
  run_number: 1,
  provider: 'fixture',
  model: 'astrion-fixture-v1',
  created_at: '2026-11-12T10:01:00Z',
  content: {
    title: 'Fixture report',
    answer_status: 'partially_answered',
    executive_summary: 'Summary text.',
    key_findings: [{ statement: 'Warming is linked to bleaching.', claim_refs: ['C1'], confidence: 'medium', basis: 'one explicit claim' }],
    hypotheses: [],
    contradictions: [],
    unresolved_questions: ['What about cooler sites?'],
    limitations: ['Rule-based fixture.'],
    citations: {
      C1: {
        claim_id: 'c1',
        statement: 'Warming increases bleaching.',
        kind: 'explicit',
        temporal_scope: null,
        document: { id: 'd1', title: 'survey.txt' },
        source: { id: 's1', title: 'Reef monitoring', uri: null },
        evidence: [{ quote: 'Ocean warming increases coral bleaching', locator: {} }],
      },
    },
    hypothesis_ids: {},
    contradiction_ids: {},
    documents_without_evidence: [],
    generated_by: { provider: 'fixture', model: 'astrion-fixture-v1', is_fixture: true },
  },
};

let state: { detail: InvestigationDetail; executions: AgentExecution[]; reports: InvestigationReport[] };
let calls: string[];

function respond(url: string) {
  const path = url.replace(/^.*\/api\/v1/, '').split('?')[0];
  calls.push(path);
  const routesMap: Record<string, unknown> = {
    '/intelligence/status': {
      configured: true,
      provider: 'fixture',
      model: 'astrion-fixture-v1',
      is_fixture: true,
      neo4j_configured: false,
      detail: 'fixture',
    },
    [`/investigations/${INV}`]: state.detail,
    [`/investigations/${INV}/executions`]: state.executions,
    [`/investigations/${INV}/claims`]: [],
    [`/investigations/${INV}/hypotheses`]: [],
    [`/investigations/${INV}/contradictions`]: [],
    [`/investigations/${INV}/reports`]: state.reports,
    [`/investigations/${INV}/graph-changes`]: [],
    [`/workspaces/${WS}/graph`]: graph,
    '/workspaces': { items: [{ id: WS, name: 'Reef', description: null, created_at: '', updated_at: '', source_count: 1 }], total: 1, limit: 100, offset: 0 },
  };
  const body = path in routesMap ? routesMap[path] : { error: { code: 'not_found', message: 'nope' } };
  return Promise.resolve(new Response(JSON.stringify(body), { status: path in routesMap ? 200 : 404, headers: { 'Content-Type': 'application/json' } }));
}

function renderWorkbench() {
  const router = createMemoryRouter(routes, { initialEntries: [`/app/investigations/${INV}`], future: routerFuture });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  state = { detail: base, executions: [execution({})], reports: [report] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => respond(String(input))),
  );
  useAuth.setState({
    status: 'authenticated',
    user: { id: 'u', email: 'a@example.org', display_name: 'A', created_at: '' },
    accessToken: 't',
    expiresAt: Date.now() + 60_000,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InvestigationWorkbenchPage', () => {
  it('labels fixture output as not AI and shows recorded stage states', async () => {
    renderWorkbench();
    expect(await screen.findByText(/Fixture provider — not AI/i, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('investigation-status')).toHaveTextContent('Completed');
    const stages = screen.getByRole('list', { name: 'Pipeline stages' });
    expect(within(stages).getByText('Graph sync').closest('li')).toHaveAttribute('data-status', 'skipped');
    const row = await screen.findByTestId('execution');
    expect(row).toHaveAttribute('data-status', 'succeeded');
    fireEvent.click(within(row).getByRole('button'));
    expect(await screen.findByText(/quote not found verbatim/i)).toBeInTheDocument(); // validation notes are visible
  });

  it('shows a cited report with quotes, document and source', async () => {
    renderWorkbench();
    fireEvent.click(await screen.findByRole('radio', { name: 'Report' }, { timeout: 5000 }));
    const rep = await screen.findByTestId('report');
    expect(within(rep).getByText('Warming is linked to bleaching.')).toBeInTheDocument();
    expect(within(rep).getByText(/Ocean warming increases coral bleaching/)).toBeInTheDocument();
    expect(within(rep).getByText(/survey\.txt/)).toBeInTheDocument();
    expect(within(rep).getByText(/rule-based fixture, not AI/)).toBeInTheDocument();
  });

  it('offers resume after a failure and never shows a report for it', async () => {
    state.detail = { ...base, status: 'failed', error: 'r1:hypothesis: ProviderBadRequestError', can_resume: true };
    state.reports = [];
    renderWorkbench();
    expect(await screen.findByRole('button', { name: /resume/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('ProviderBadRequestError');
    fireEvent.click(screen.getByRole('radio', { name: 'Report' }));
    expect(await screen.findByText(/Failed or cancelled runs never produce one/)).toBeInTheDocument();
  });

  it('renders the recorded graph (list fallback without WebGL) with its data source', async () => {
    renderWorkbench();
    fireEvent.click(await screen.findByRole('radio', { name: 'Knowledge graph' }, { timeout: 5000 }));
    const list = await screen.findByRole('list', { name: 'Graph nodes' });
    expect(within(list).getByText('Ocean warming')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL registry')).toBeInTheDocument();
  });

  it('shows no fabricated activity before the first run', async () => {
    state.detail = { ...base, status: 'draft', run_count: 0, progress: [], counts: {}, llm_provider: null, llm_model: null };
    state.executions = [];
    state.reports = [];
    renderWorkbench();
    expect(await screen.findByText(/No agent has run yet/i, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pipeline stages' })).toBeNull();
    expect(screen.getByRole('button', { name: /start investigation/i })).toBeInTheDocument();
  });

  it('polls while the server reports the run active, and stops when it finishes', async () => {
    state.detail = { ...base, status: 'running', can_start: false, can_cancel: true };
    renderWorkbench();
    expect(await screen.findByRole('button', { name: /cancel/i }, { timeout: 5000 })).toBeInTheDocument();
    const detailCalls = () => calls.filter((c) => c === `/investigations/${INV}`).length;
    const before = detailCalls();
    await act(() => new Promise((r) => setTimeout(r, 1800)));
    expect(detailCalls()).toBeGreaterThan(before);
    state.detail = { ...base, status: 'completed' };
    await act(() => new Promise((r) => setTimeout(r, 1800)));
    expect(await screen.findByTestId('investigation-status')).toHaveTextContent('Completed');
    const settled = detailCalls();
    await act(() => new Promise((r) => setTimeout(r, 1800)));
    expect(detailCalls()).toBe(settled);
  }, 15_000);
});
