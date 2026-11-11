import { AGENTS } from '@/data/sample/agents';
import { SampleWalkthrough } from '@/features/agents/components/SampleWalkthrough';
import { SectionIntro } from '../components/SectionIntro';

export function IntelligenceSection() {
  return (
    <section id="intelligence" aria-labelledby="intel-title" className="relative scroll-mt-16 border-t border-line/60 py-28 md:py-36">
      <div className="mx-auto max-w-[1240px] px-5 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-end">
          <SectionIntro index="04" eyebrow="Intelligence network" title="Agents that question, challenge and verify each other." id="intel-title">
            <p>
              ASTRION’s planned investigation engine divides reasoning across specialised agents. Each one has a single responsibility, every handoff is
              recorded, and nothing becomes a finding until a verifier has tied it to evidence.
            </p>
          </SectionIntro>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {AGENTS.map((a) => (
              <div key={a.role} className="border-l border-line pl-3">
                <dt className="flex items-center gap-1.5 font-display text-[0.85rem] font-medium" style={{ color: a.color }}>
                  <a.icon size={13} /> {a.name}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-ink-faint">{a.responsibility.split(' — ')[0].split('.')[0]}.</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="mt-14">
          <SampleWalkthrough />
        </div>
      </div>
    </section>
  );
}
