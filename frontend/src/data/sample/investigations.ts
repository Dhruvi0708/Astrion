/**
 * SAMPLE INVESTIGATIONS — illustrative only. Hand-written to show the Investigation Room layout.
 * Not produced by AI agents; no investigation engine exists in Phase 1.
 */
export type ClaimStance = 'supports' | 'contradicts' | 'context';

export interface SampleClaim {
  id: string;
  statement: string;
  stance: ClaimStance;
  evidenceIds: string[];
  status: 'extracted' | 'challenged' | 'accepted';
}

export interface TimelineEvent {
  id: string;
  label: string;
  detail: string;
  kind: 'created' | 'source' | 'claim' | 'challenge' | 'finding' | 'planned';
  at: string;
}

export interface SampleInvestigation {
  id: string;
  title: string;
  question: string;
  status: 'draft' | 'active' | 'paused' | 'closed';
  sourceIds: string[];
  claims: SampleClaim[];
  findings: { id: string; text: string; status: 'draft' | 'unverified' | 'conditional'; basis: string[] }[];
  timeline: TimelineEvent[];
  updated: string;
}

export const SAMPLE_INVESTIGATIONS: SampleInvestigation[] = [
  {
    id: 'inv-1',
    title: 'Mangroves and extreme surge',
    question: 'Do mangrove belts reduce flood exposure during extreme storm surge, and under which conditions?',
    status: 'active',
    sourceIds: ['srcB', 'srcD'],
    claims: [
      { id: 'cl3', statement: 'Mangrove belts reduce wave energy reaching the shore.', stance: 'supports', evidenceIds: ['ev3'], status: 'accepted' },
      { id: 'cl4', statement: 'Mangroves gave limited protection under the most extreme surge scenario.', stance: 'contradicts', evidenceIds: ['ev4'], status: 'challenged' },
      { id: 'cl6', statement: 'Flood events precede waterborne illness reports.', stance: 'context', evidenceIds: ['ev6'], status: 'extracted' },
    ],
    findings: [
      { id: 'f1', text: 'Protection appears to depend on surge magnitude; evidence for extreme events is limited to one source.', status: 'conditional', basis: ['ev3', 'ev4'] },
      { id: 'f2', text: 'No sample source quantifies belt width, so the conditions cannot yet be compared.', status: 'draft', basis: [] },
    ],
    timeline: [
      { id: 't1', label: 'Investigation opened', detail: 'Research question recorded.', kind: 'created', at: 'Day 1' },
      { id: 't2', label: 'Sources attached', detail: 'Source B and Source D linked to the investigation.', kind: 'source', at: 'Day 1' },
      { id: 't3', label: 'Claims identified', detail: 'Three claims extracted manually for this sample.', kind: 'claim', at: 'Day 2' },
      { id: 't4', label: 'Contradiction flagged', detail: 'Claims C3 and C4 disagree under extreme conditions.', kind: 'challenge', at: 'Day 2' },
      { id: 't5', label: 'Draft finding', detail: 'Conditional finding recorded pending more evidence.', kind: 'finding', at: 'Day 3' },
      { id: 't6', label: 'Agent investigation', detail: 'Automated questioning and verification (planned).', kind: 'planned', at: 'Planned' },
    ],
    updated: 'Sample · 3 days of activity',
  },
  {
    id: 'inv-2',
    title: 'Reef condition and livelihoods',
    question: 'Is reef degradation associated with lower fishery landings in the sample region?',
    status: 'draft',
    sourceIds: ['srcA', 'srcC'],
    claims: [
      { id: 'cl1', statement: 'Warm anomalies co-occur with bleaching at surveyed sites.', stance: 'supports', evidenceIds: ['ev1'], status: 'extracted' },
      { id: 'cl5', statement: 'Landings fell in seasons after reef degradation.', stance: 'supports', evidenceIds: ['ev5'], status: 'extracted' },
    ],
    findings: [{ id: 'f3', text: 'Association is plausible but sites and periods in the two sources do not yet align.', status: 'unverified', basis: ['ev1', 'ev5'] }],
    timeline: [
      { id: 't1', label: 'Investigation opened', detail: 'Research question recorded.', kind: 'created', at: 'Day 1' },
      { id: 't2', label: 'Sources attached', detail: 'Source A and Source C linked.', kind: 'source', at: 'Day 1' },
      { id: 't3', label: 'Agent investigation', detail: 'Automated questioning and verification (planned).', kind: 'planned', at: 'Planned' },
    ],
    updated: 'Sample · draft',
  },
];
