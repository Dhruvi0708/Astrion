import { describe, expect, it } from 'vitest';
import { computeLayout } from '@/features/universe/graph/layout';
import { computeCoverage } from '@/features/discovery/coverage';
import { BASELINE, PRESETS, runScenario } from '@/features/simulation/model';
import { SAMPLE_SEQUENCE } from './agents';
import { DISCOVERIES, evidenceById, EVIDENCE } from './discoveries';
import { graphStats, nodeById, sampleGraph } from './graph';
import { SAMPLE_INVESTIGATIONS } from './investigations';

describe('sample graph integrity', () => {
  it('has unique ids and edges that reference existing nodes', () => {
    expect(new Set(sampleGraph.nodes.map((n) => n.id)).size).toBe(sampleGraph.nodes.length);
    for (const e of sampleGraph.edges) {
      expect(nodeById.has(e.source), e.source).toBe(true);
      expect(nodeById.has(e.target), e.target).toBe(true);
      expect(e.confidence).toBeGreaterThanOrEqual(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('is flagged as sample data', () => {
    expect(sampleGraph.isSample).toBe(true);
    expect(nodeById.get('srcA')?.summary).toMatch(/not a real document/i);
  });

  it('every claim cites at least one source', () => {
    for (const claim of sampleGraph.nodes.filter((n) => n.kind === 'claim')) {
      expect(sampleGraph.edges.some((e) => e.source === claim.id && e.kind === 'mentions'), claim.id).toBe(true);
    }
  });

  it('computes stats', () => {
    const s = graphStats(sampleGraph);
    expect(s.nodes).toBe(sampleGraph.nodes.length);
    expect(Object.values(s.byKind).reduce((a, b) => a + b, 0)).toBe(s.nodes);
  });
});

describe('layout', () => {
  it('is deterministic and finite', () => {
    const a = computeLayout(sampleGraph);
    const b = computeLayout({ ...sampleGraph });
    for (const n of sampleGraph.nodes) {
      const p = a.positions.get(n.id)!;
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(b.positions.get(n.id)).toEqual(p);
    }
  });
});

describe('discoveries & investigations', () => {
  it('reference valid evidence and concepts', () => {
    for (const d of DISCOVERIES) {
      d.evidenceIds.forEach((id) => expect(evidenceById.has(id), id).toBe(true));
      d.conceptIds.forEach((id) => expect(nodeById.has(id), id).toBe(true));
    }
    EVIDENCE.forEach((e) => expect(nodeById.get(e.sourceId)?.kind).toBe('source'));
    for (const inv of SAMPLE_INVESTIGATIONS) inv.claims.forEach((c) => c.evidenceIds.forEach((id) => expect(evidenceById.has(id)).toBe(true)));
  });

  it('never marks sample content as verified', () => {
    expect(DISCOVERIES.every((d) => d.status !== 'verified')).toBe(true);
  });

  it('agent handoffs follow the sequence', () => {
    SAMPLE_SEQUENCE.slice(0, -1).forEach((s, i) => expect(s.handoffTo).toBe(SAMPLE_SEQUENCE[i + 1].role));
  });
});

describe('coverage', () => {
  it('finds gaps as zero cells', () => {
    const { cells, uncovered } = computeCoverage(sampleGraph);
    expect(cells.some((c) => c.claims > 0)).toBe(true);
    expect(cells.some((c) => c.claims === 0)).toBe(true);
    expect(uncovered.map((n) => n.id)).toContain('marsh');
  });
});

describe('toy simulation model', () => {
  it('baseline vs itself is identical; mitigation lowers flood exposure', () => {
    const base = runScenario(BASELINE);
    expect(runScenario(BASELINE)).toEqual(base);
    const combined = runScenario(PRESETS.find((p) => p.id === 'combined')!.params);
    expect(combined[10].flood).toBeLessThan(base[10].flood);
    expect(base).toHaveLength(11);
  });
});
