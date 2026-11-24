import { ArrowRight, Brain, Compass, FileSearch, GitMerge, Lightbulb, MessagesSquare, Network, ScrollText, ShieldCheck, Swords } from 'lucide-react';
import { SectionIntro } from '../components/SectionIntro';

const AGENTS = [
  { name: 'Orchestrator', icon: Compass, duty: 'Breaks the question into sub-questions and evidence needs.' },
  { name: 'Research', icon: FileSearch, duty: 'Extracts claims with verbatim quotes from each document.' },
  { name: 'Knowledge', icon: GitMerge, duty: 'Resolves duplicates and grows the knowledge graph.' },
  { name: 'Planner', icon: Brain, duty: 'Decides what to read next — or that the evidence suffices.' },
  { name: 'Hypothesis', icon: Lightbulb, duty: 'Proposes testable explanations with falsification conditions.' },
  { name: 'Contradiction', icon: Network, duty: 'Finds conflicting claims and when they apply.' },
  { name: 'Challenger', icon: Swords, duty: 'Argues against every hypothesis with counter-evidence.' },
  { name: 'Verification', icon: ShieldCheck, duty: 'Independently judges each hypothesis and conflict.' },
  { name: 'Synthesis', icon: ScrollText, duty: 'Writes the cited report and its open questions.' },
];

const FLOW = [
  'Recall what the workspace already knows',
  'Plan sub-questions',
  'Read the most relevant passages',
  'Assess coverage — read more, or stop',
  'Propose hypotheses and find conflicts',
  'Debate: challenge and defend with evidence',
  'Verify independently, reach consensus',
  'Report, with every finding cited',
];

export function IntelligenceSection() {
  return (
    <section id="intelligence" aria-labelledby="intel-title" className="relative scroll-mt-16 border-t border-line/60 py-28 md:py-36">
      <div className="mx-auto max-w-[1240px] px-5 md:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <SectionIntro index="04" eyebrow="Intelligence network" title="Agents that question, challenge and verify each other." id="intel-title">
            <p>
              Each agent has one responsibility and a typed contract. Every step is recorded with its inputs, outputs, model and cost, and nothing becomes a
              finding until it is tied to a verbatim quote. Runs are bounded by hard budgets and can be resumed after any failure.
            </p>
          </SectionIntro>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((a) => (
              <div key={a.name} className="border-l border-line pl-3">
                <dt className="flex items-center gap-1.5 font-display text-[0.85rem] font-medium text-ink">
                  <a.icon size={13} className="text-cyan" /> {a.name}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-ink-faint">{a.duty}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="mt-16">
          <p className="eyebrow mb-4 flex items-center gap-2">
            <MessagesSquare size={12} /> How an investigation runs
          </p>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((step, i) => (
              <li key={step} className="panel flex items-start gap-3 px-4 py-3.5">
                <span className="font-mono text-2xs text-cyan">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[0.82rem] leading-snug text-ink">{step}</span>
                {i < FLOW.length - 1 && <ArrowRight size={12} className="ml-auto mt-1 hidden shrink-0 text-ink-faint lg:block" />}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
