import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { Badge, SampleBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { agentByRole, SAMPLE_SEQUENCE } from '@/data/sample/agents';
import { cn } from '@/lib/cn';
import { useInView, useReducedMotionPreference } from '@/lib/hooks';
import { AgentWorkflow } from './AgentWorkflow';

const VERIFICATION_LABEL = {
  unverified: { tone: 'unverified', label: 'Unverified' },
  conflict: { tone: 'conflict', label: 'Contradiction' },
  gap: { tone: 'gap', label: 'Knowledge gap' },
  conditional: { tone: 'hypothesis', label: 'Conditional · unresolved' },
} as const;

/**
 * Step-through of a hand-written sample sequence. Users control playback; nothing here is generated
 * by a running agent — the UI says so explicitly.
 */
export function SampleWalkthrough({ autoPlay = true, dense, showWorkflow = true }: { autoPlay?: boolean; dense?: boolean; showWorkflow?: boolean }) {
  const [step, setStep] = useState(0);
  const reduced = useReducedMotionPreference();
  const [playing, setPlaying] = useState(autoPlay && !reduced);
  const [ref, inView] = useInView<HTMLDivElement>();
  const current = SAMPLE_SEQUENCE[step];

  useEffect(() => {
    if (!playing || !inView) return;
    const t = window.setTimeout(() => {
      if (step >= SAMPLE_SEQUENCE.length - 1) setPlaying(false);
      else setStep((s) => s + 1);
    }, 3200);
    return () => window.clearTimeout(t);
  }, [playing, inView, step]);

  const go = (i: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(SAMPLE_SEQUENCE.length - 1, i)));
  };

  return (
    <div ref={ref} className="space-y-5">
      {showWorkflow && <AgentWorkflow activeRole={current.role} nextRole={current.handoffTo} />}

      <div className="panel overflow-hidden bg-surface/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <SampleBadge label="Illustrative sequence" />
            <span className="text-2xs text-ink-faint">No agents are running — this walkthrough is hand-written.</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Previous step" onClick={() => go(step - 1)} disabled={step === 0}>
              <ChevronLeft size={15} />
            </Button>
            {step === SAMPLE_SEQUENCE.length - 1 && !playing ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Restart walkthrough"
                onClick={() => {
                  setStep(0);
                  setPlaying(true);
                }}
              >
                <RotateCcw size={14} />
              </Button>
            ) : (
              <Button size="icon" variant="ghost" aria-label={playing ? 'Pause walkthrough' : 'Play walkthrough'} onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </Button>
            )}
            <Button size="icon" variant="ghost" aria-label="Next step" onClick={() => go(step + 1)} disabled={step === SAMPLE_SEQUENCE.length - 1}>
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
        <div className={cn('grid gap-0', dense ? 'md:grid-cols-[220px_1fr]' : 'md:grid-cols-[260px_1fr]')}>
          <ol className="border-b border-line p-2 md:border-b-0 md:border-r" aria-label="Walkthrough steps">
            {SAMPLE_SEQUENCE.map((s, i) => {
              const agent = agentByRole[s.role];
              return (
                <li key={s.id}>
                  <button
                    onClick={() => go(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors', i === step ? 'bg-raised text-ink' : i < step ? 'text-ink-muted hover:bg-raised/50' : 'text-ink-faint hover:bg-raised/50')}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i <= step ? agent.color : 'rgb(var(--line-strong))' }} />
                    <span className="font-mono text-2xs text-ink-faint">0{i + 1}</span>
                    <span className="truncate">{agent.name}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="min-h-[170px] p-5" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div key={current.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-medium" style={{ color: agentByRole[current.role].color }}>
                    {agentByRole[current.role].name}
                  </span>
                  <span className="text-xs text-ink-muted">{current.action}</span>
                  {current.verification && <Badge tone={VERIFICATION_LABEL[current.verification].tone}>{VERIFICATION_LABEL[current.verification].label}</Badge>}
                </div>
                <p className="mt-3 leading-relaxed text-ink">{current.detail}</p>
                {current.handoffTo && (
                  <p className="mt-4 text-xs text-ink-faint">
                    Hands off to <span style={{ color: agentByRole[current.handoffTo].color }}>{agentByRole[current.handoffTo].name}</span>
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
