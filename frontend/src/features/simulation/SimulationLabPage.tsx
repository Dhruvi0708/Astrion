import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Table2 } from 'lucide-react';
import { Badge, PlannedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Notice, Page, PageHeader } from '@/components/layout/PageHeader';
import { cn } from '@/lib/cn';
import { ASSUMPTIONS, BASELINE, FORMULAS, LIMITATIONS, OUTCOMES, PARAM_SPECS, PRESETS, runScenario, type OutcomeKey, type ScenarioParams } from './model';
import { ScenarioChart, SERIES } from './ScenarioChart';

function pctChange(base: number, alt: number) {
  return ((alt - base) / base) * 100;
}

export default function SimulationLabPage() {
  const [name, setName] = useState('Combined adaptation');
  const [params, setParams] = useState<ScenarioParams>(PRESETS[2].params);
  const [outcome, setOutcome] = useState<OutcomeKey>('flood');
  const [showTable, setShowTable] = useState(false);
  useEffect(() => {
    document.title = 'Simulation Laboratory · ASTRION';
  }, []);

  const baseline = useMemo(() => runScenario(BASELINE), []);
  const alternative = useMemo(() => runScenario(params), [params]);
  const last = baseline.length - 1;
  const impacts = (Object.keys(OUTCOMES) as OutcomeKey[]).map((k) => {
    const delta = pctChange(baseline[last][k], alternative[last][k]);
    const improves = OUTCOMES[k].better === 'lower' ? delta < 0 : delta > 0;
    return { key: k, delta, improves, base: baseline[last][k], alt: alternative[last][k] };
  });
  const maxAbs = Math.max(10, ...impacts.map((i) => Math.abs(i.delta)));

  return (
    <Page>
      <PageHeader
        eyebrow="Simulation Laboratory"
        title="Simulation Laboratory"
        badges={<Badge tone="sample">Illustrative toy model</Badge>}
        description="Compare a baseline with an alternative scenario, adjust assumptions, and see how outcomes diverge. Every formula is visible."
      />
      <Notice className="mt-5">
        This is <strong className="font-medium text-ink">not a simulation</strong>. It is a transparent toy model with invented coefficients, used to demonstrate the scenario workspace. Results are unitless indices and must not be interpreted as predictions. Evidence-grounded simulation is planned.
      </Notice>

      <div className="mt-6 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Scenario workspace" eyebrow="Parameters">
          <label htmlFor="scenario-name" className="text-xs text-ink-muted">
            Scenario name
          </label>
          <Input id="scenario-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" maxLength={80} />
          <p className="eyebrow mb-2 mt-5">Presets</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setParams(p.params);
                  setName(p.label);
                }}
                className="rounded border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-5 space-y-5">
            {PARAM_SPECS.map((s) => {
              const v = params[s.key];
              const changed = v !== BASELINE[s.key];
              return (
                <div key={s.key}>
                  <div className="flex items-center justify-between">
                    <label htmlFor={`p-${s.key}`} className="text-xs text-ink">
                      {s.label}
                    </label>
                    <span className={cn('font-mono text-xs', changed ? 'text-cyan' : 'text-ink-muted')}>
                      {v}
                      {s.unit}
                    </span>
                  </div>
                  <input
                    id={`p-${s.key}`}
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={v}
                    onChange={(e) => setParams((p) => ({ ...p, [s.key]: Number(e.target.value) }))}
                    className="mt-2 w-full accent-[rgb(var(--cyan))]"
                    aria-describedby={`p-${s.key}-hint`}
                  />
                  <p id={`p-${s.key}-hint`} className="mt-1 flex justify-between text-2xs text-ink-faint">
                    <span>{s.hint}</span>
                    <span>
                      base {BASELINE[s.key]}
                      {s.unit}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-5"
            onClick={() => {
              setParams(BASELINE);
              setName('Baseline copy');
            }}
          >
            <RotateCcw size={13} /> Reset to baseline
          </Button>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Baseline vs alternative"
            eyebrow={`Scenario · ${name || 'Untitled'}`}
            actions={
              <>
                <Segmented
                  label="Outcome shown"
                  value={outcome}
                  onChange={setOutcome}
                  options={[
                    { value: 'flood', label: 'Flood' },
                    { value: 'buffer', label: 'Buffer' },
                    { value: 'risk', label: 'Risk' },
                  ]}
                />
                <Button size="icon" variant="ghost" aria-pressed={showTable} aria-label="Toggle data table" onClick={() => setShowTable((v) => !v)}>
                  <Table2 size={14} />
                </Button>
              </>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
              <span className="flex items-center gap-2">
                <svg width="20" height="4" aria-hidden>
                  <line x1="0" y1="2" x2="20" y2="2" stroke={SERIES.baseline} strokeWidth="2" strokeDasharray="5 4" />
                </svg>
                Baseline
              </span>
              <span className="flex items-center gap-2">
                <svg width="20" height="4" aria-hidden>
                  <line x1="0" y1="2" x2="20" y2="2" stroke={SERIES.alternative} strokeWidth="2" />
                </svg>
                Alternative · {name || 'Untitled'}
              </span>
              <span className="ml-auto text-2xs text-ink-faint">
                {OUTCOMES[outcome].label} · {OUTCOMES[outcome].better} is better · unitless
              </span>
            </div>
            <ScenarioChart outcome={outcome} baseline={baseline} alternative={alternative} />
            {showTable && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">{OUTCOMES[outcome].label} by year</caption>
                  <thead>
                    <tr className="text-left text-ink-faint">
                      <th scope="col" className="py-1.5 font-normal">
                        Year
                      </th>
                      <th scope="col" className="py-1.5 text-right font-normal">
                        Baseline
                      </th>
                      <th scope="col" className="py-1.5 text-right font-normal">
                        Alternative
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {baseline.map((r, i) => (
                      <tr key={r.t} className="border-t border-line">
                        <td className="py-1.5 text-ink-muted">Y{r.t}</td>
                        <td className="py-1.5 text-right text-ink">{r[outcome].toFixed(1)}</td>
                        <td className="py-1.5 text-right text-ink">{alternative[i][outcome].toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Impact at year 10" eyebrow="Change vs baseline">
              <ul className="space-y-4">
                {impacts.map((i) => (
                  <li key={i.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink">{OUTCOMES[i.key].label}</span>
                      <span className="font-mono text-ink">
                        {i.delta > 0 ? '+' : ''}
                        {i.delta.toFixed(1)}%
                      </span>
                    </div>
                    <div className="relative mt-2 h-2 rounded-full bg-deep">
                      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-line-strong" />
                      <span
                        className="absolute inset-y-0 rounded-[4px]"
                        style={{
                          background: SERIES.alternative,
                          width: `${(Math.abs(i.delta) / maxAbs) * 50}%`,
                          left: i.delta >= 0 ? '50%' : undefined,
                          right: i.delta < 0 ? '50%' : undefined,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-2xs text-ink-faint">
                      {Math.abs(i.delta) < 0.05 ? 'No change' : i.improves ? 'Improves on baseline' : 'Worse than baseline'} · {OUTCOMES[i.key].better} is better
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Results" eyebrow="Year 10 · index values">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-faint">
                    <th scope="col" className="pb-2 font-normal">
                      Outcome
                    </th>
                    <th scope="col" className="pb-2 text-right font-normal">
                      Baseline
                    </th>
                    <th scope="col" className="pb-2 text-right font-normal">
                      Alternative
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {impacts.map((i) => (
                    <tr key={i.key} className="border-t border-line">
                      <th scope="row" className="py-2 text-left font-normal text-ink-muted">
                        {OUTCOMES[i.key].label}
                      </th>
                      <td className="py-2 text-right font-mono text-ink">{i.base.toFixed(1)}</td>
                      <td className="py-2 text-right font-mono text-ink">{i.alt.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-2xs leading-relaxed text-ink-faint">Computed in your browser from the toy formulas below. Not stored, not evidence-based.</p>
            </Panel>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Model" eyebrow="Formulas" actions={<PlannedBadge label="Real engine planned" />}>
          <ul className="space-y-1.5">
            {FORMULAS.map((f) => (
              <li key={f} className="rounded border border-line bg-deep px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-ink-muted">
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs text-ink-faint">m = mangrove ÷ 100, d = drainage ÷ 100, slr = sea-level multiplier, t = year.</p>
        </Panel>
        <Panel title="Assumptions" eyebrow="What the model takes as given">
          <ul className="space-y-2.5">
            {ASSUMPTIONS.map((a) => (
              <li key={a} className="flex gap-2.5 text-xs leading-relaxed text-ink-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan" />
                {a}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Limitations" eyebrow="Read before interpreting">
          <ul className="space-y-2.5">
            {LIMITATIONS.map((a) => (
              <li key={a} className="flex gap-2.5 text-xs leading-relaxed text-ink-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-caution" />
                {a}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
