import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes, routerFuture } from '@/app/router';
import { useAuth } from '@/features/auth/store';
import { usePreferences } from '@/stores/ui';
import type {
  Assessment,
  ClaimRecord,
  ContradictionRecord,
  HypothesisRecord,
  InvestigationDetail,
  RunRecord,
  SourceAssessmentRecord,
  WorkspaceInsights,
} from '@/lib/api/types';

const WS = 'ws-1';
const INV = 'inv-1';

const detail: InvestigationDetail = {
  id: INV,
  workspace_id: WS,
  title: 'Warming and bleaching',
  question: 'Does ocean warming increase coral bleaching?',
  status: 'completed',
  document_ids: [],
  summary: null,
  error: null,
  run_count: 1,
  started_at: null,
  finished_at: null,
  llm_provider: 'fixture',
  llm_model: 'astrion-fixture-v1',
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  created_at: '2026-11-15T00:00:00Z',
  updated_at: '2026-11-15T00:00:00Z',
  plan: null,
  progress: [],
  counts: { claims: 1, hypotheses: 1, contradictions: 1 },
  can_start: true,
  can_resume: false,
  can_cancel: false,
};

const run: RunRecord = {
  run_number: 1,
  status: 'completed',
  provider: 'fixture',
  model: 'astrion-fixture-v1',
  budget: { max_llm_calls: 40, max_tokens: 2_000_000, max_cost_usd: 20, max_iterations: 3 },
  usage: { llm_calls: 13, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
  iterations: 2,
  stop_reason: 'Every sub-question has evidence and no unread passage adds value.',
  plan_history: [{ iteration: 1, selected_actions: ['A1'], added_sub_questions: [], evidence_gaps: ['Q2'], rationale: 'Read the best candidate.' }],
  recommendations: [
    {
      kind: 'test_hypothesis',
      target: "Test 'warming drives bleaching' — check: a cool year with bleaching",
      score: 0.62,
      factors: { uncertainty: 0.9, relevance: 0.8, information_gain: 0.7, evidence_quality: 0, contradiction: 0 },
      explanation: "Test 'warming drives bleaching' — check: a cool year with bleaching — selected because: little evidence so far (score 0.62).",
      method: 'astrion-active-v1',
    },
  ],
  started_at: null,
  finished_at: null,
};

const assessments: Assessment[] = [
  {
    iteration: 1,
    coverage: [{ sub_question_id: 'Q1', question: 'Does warming increase bleaching?', claims: 1, explicit: 1, documents: 1 }],
    candidates: [
      {
        id: 'A1',
        kind: 'research_subquestion',
        target: 'Q2: What weakens the premise?',
        chunk_ids: ['c1'],
        factors: { uncertainty: 1, relevance: 0.8, information_gain: 0.6, evidence_quality: 1, contradiction: 0 },
        score: 0.8,
        explanation: 'Q2: What weakens the premise? — selected because: little evidence so far (score 0.8).',
        sub_question_id: 'Q2',
      },
    ],
    unread_passages: 3,
    stop: false,
    reason: '1 sub-question(s) under-covered; best action A1 scores 0.8.',
    usage: run.usage,
  },
];

const claim: ClaimRecord = {
  id: 'c-old',
  statement: 'Bleaching affected 30 percent of sites in 2019.',
  kind: 'explicit',
  confidence: 0.66,
  temporal_scope: '2019',
  extractor: 'fixture',
  subject: { id: 'e1', name: 'bleaching', entity_type: 'concept' },
  document: { id: 'd1', title: 'survey-2019.txt' },
  source: { id: 's1', title: 'Reef 2019', uri: null },
  evidence: [{ id: 'ev', quote: 'Bleaching affected 30 percent of sites in 2019.', locator: {}, stance: 'supports' }],
  investigation_id: INV,
  created_at: '2026-11-15T00:00:00Z',
  valid_from_year: 2019,
  valid_to_year: 2019,
  superseded_by_id: 'c-new',
};

const hypothesis: HypothesisRecord = {
  id: 'h1',
  statement: 'Warming drives bleaching on the northern reef.',
  rationale: 'Two surveys agree.',
  test_plan: 'Compare a cool year.',
  origin: 'ai_generated',
  status: 'conditional',
  confidence: 0.4,
  confidence_method: null,
  supporting_claim_ids: ['c-old'],
  opposing_claim_ids: [],
  verification: null,
  generated_by_execution_id: null,
  reasoning_type: 'correlation',
  assumptions: ['Sites are comparable'],
  falsification_conditions: ['Bleaching in a year without warming'],
  consensus: 'contested',
  revises_hypothesis_id: 'h0',
  debate: {
    strength: 'moderate',
    standing_objections: 1,
    reasoning_check: 'Declared causation, but no cited claim asserts a causal relationship: downgraded to correlation.',
    objections: [
      {
        id: 'H1.O1',
        kind: 'confounder',
        argument: 'Turbidity could explain it.',
        cited_claim_ids: [],
        response: { stance: 'rebut', argument: 'It does not.', cited_claim_ids: [] },
        answered_with_evidence: false,
      },
    ],
  },
};

const contradiction: ContradictionRecord = {
  id: 'x1',
  kind: 'temporal',
  is_genuine: true,
  severity: 'medium',
  explanation: 'Different figures.',
  claim_a: claim,
  claim_b: { ...claim, id: 'c-new', statement: 'Bleaching affected 61 percent of sites in 2023.', superseded_by_id: null },
  verification: null,
  resolution_kind: 'temporal',
  resolution: 'Different periods (2019 vs 2023): both statements can hold at their own time.',
};

const sources: SourceAssessmentRecord[] = [
  {
    source: { id: 's1', title: 'Reef 2019', source_type: 'report', uri: null, published_on: '2019-12-01' },
    independence_group: 'g:1',
    relevance: 1,
    credibility: 0.7,
    recency: 0.3,
    independence: 0.5,
    corroboration: 0,
    details: {
      method: 'astrion-source-v1',
      claims: 2,
      corroborated_claims: 0,
      credibility_basis: "prior for source type 'report'",
      recency_basis: '6 years',
      shares_origin_with: 1,
    },
  },
];

const insights: WorkspaceInsights = {
  method: 'astrion-insights-v1',
  investigations: 2,
  bridging_entities: [{ entity_id: 'e1', name: 'bleaching', investigations: ['First', 'Second'] }],
  corroborated_relationships: [],
  connections: [
    {
      from: 'warming',
      to: 'fish',
      via: 'bleaching',
      path: 'warming —causes— bleaching —associated_with— fish',
      from_investigations: ['First'],
      to_investigations: ['Second'],
      explanation: '',
    },
  ],
  patterns: [{ pattern: 'concept —causes→ concept', investigations: 2 }],
  hypothesis_evolution: [
    {
      from: { id: 'h0', statement: 'Earlier idea', status: 'unverified', confidence: 0.2, investigation: 'First' },
      to: { id: 'h1', statement: 'Revised idea', status: 'conditional', confidence: 0.4, investigation: 'Second' },
      link: 'revision',
      confidence_change: 0.2,
      status_changed: true,
    },
  ],
  gaps: { single_claim_entities: [], weakly_supported_relationships: [], open_hypotheses: [], unresolved_contradictions: [], unanswered_sub_questions: [] },
};

function respond(url: string) {
  const path = url.replace(/^.*\/api\/v1/, '').split('?')[0];
  const map: Record<string, unknown> = {
    '/intelligence/status': { configured: true, provider: 'fixture', model: 'astrion-fixture-v1', is_fixture: true, neo4j_configured: false, detail: '' },
    [`/investigations/${INV}`]: detail,
    [`/investigations/${INV}/executions`]: [],
    [`/investigations/${INV}/claims`]: [claim],
    [`/investigations/${INV}/hypotheses`]: [hypothesis],
    [`/investigations/${INV}/contradictions`]: [contradiction],
    [`/investigations/${INV}/reports`]: [],
    [`/investigations/${INV}/graph-changes`]: [],
    [`/investigations/${INV}/runs`]: [run],
    [`/investigations/${INV}/assessments`]: assessments,
    [`/investigations/${INV}/sources`]: sources,
    [`/workspaces/${WS}/insights`]: insights,
    '/workspaces': { items: [{ id: WS, name: 'Reef', description: null, created_at: '', updated_at: '', source_count: 1 }], total: 1, limit: 100, offset: 0 },
  };
  const ok = path in map;
  return Promise.resolve(new Response(JSON.stringify(ok ? map[path] : { error: { code: 'not_found', message: 'nope' } }), { status: ok ? 200 : 404 }));
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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
  usePreferences.setState({ activeWorkspaceId: WS });
});

describe('Phase 3 workbench', () => {
  it('shows how the run planned itself, why it stopped and the explained next steps', async () => {
    renderAt(`/app/investigations/${INV}`);
    fireEvent.click(await screen.findByRole('radio', { name: 'Planning & next steps' }, { timeout: 5000 }));
    expect(await screen.findByTestId('stop-reason')).toHaveTextContent('Every sub-question has evidence');
    const a = screen.getByTestId('assessment');
    expect(within(a).getByText('chosen by planner')).toBeInTheDocument();
    expect(within(a).getByText(/selected because: little evidence so far/)).toBeInTheDocument();
    expect(screen.getByTestId('next-step')).toHaveTextContent('Test');
  });

  it('shows reasoning type, consensus, falsification and the debate, with unevidenced rebuttals flagged', async () => {
    renderAt(`/app/investigations/${INV}`);
    fireEvent.click(await screen.findByRole('radio', { name: /Hypotheses & conflicts/ }, { timeout: 5000 }));
    const card = await screen.findByTestId('hypothesis');
    expect(within(card).getByText('Correlation')).toBeInTheDocument();
    expect(within(card).getByText(/consensus: Contested/)).toBeInTheDocument();
    expect(within(card).getByText('revises earlier')).toBeInTheDocument();
    expect(within(card).getByText('Bleaching in a year without warming')).toBeInTheDocument();
    expect(within(card).getByText(/downgraded to correlation/)).toBeInTheDocument();
    const debate = within(card).getByTestId('debate');
    expect(within(debate).getByText(/Not counted as answered: no evidence cited/)).toBeInTheDocument();
    expect(screen.getByTestId('resolution')).toHaveTextContent('Different periods');
  });

  it('marks outdated claims and keeps source scores separate from claim confidence', async () => {
    renderAt(`/app/investigations/${INV}`);
    fireEvent.click(await screen.findByRole('radio', { name: /^Claims/ }, { timeout: 5000 }));
    expect(await screen.findByText('outdated')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Sources' }));
    const table = await screen.findByTestId('sources');
    expect(table).toHaveTextContent('These scores describe sources, not claims');
    expect(table).toHaveTextContent('shares origin with 1 other source(s)');
  });
});

describe('Discovery Laboratory', () => {
  it('shows real workspace insights by default, with the sample lab one click away', async () => {
    renderAt('/app/discovery');
    const panel = await screen.findByTestId('insights', undefined, { timeout: 5000 });
    expect(panel).toHaveTextContent('warming —causes— bleaching —associated_with— fish');
    expect(panel).toHaveTextContent('concept —causes→ concept');
    expect(within(panel).getByTestId('evolution')).toHaveTextContent('Revised idea');
    fireEvent.click(screen.getByRole('radio', { name: 'Sample lab' }));
    expect(await screen.findByText(/hand-written sample/)).toBeInTheDocument();
  });
});
