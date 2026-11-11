import { lazy, Suspense, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { useInView, useMediaQuery, useReducedMotionPreference } from '@/lib/hooks';
import { hasWebGL } from '@/lib/webgl';
import { HeroFallback } from './HeroFallback';

const HeroScene = lazy(() => import('./HeroScene'));

const ease = [0.16, 1, 0.3, 1] as const;

export function Hero() {
  const [ref, inView] = useInView<HTMLElement>('100px');
  const reduced = useReducedMotionPreference();
  const compact = !useMediaQuery('(min-width: 1024px)');
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(hasWebGL()), []);

  return (
    <section ref={ref} id="top" aria-labelledby="hero-title" className="relative isolate flex min-h-[100svh] items-center overflow-hidden">
      {/* Atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(ellipse_70%_60%_at_68%_45%,rgb(var(--cyan)/0.07),transparent_70%),radial-gradient(ellipse_50%_50%_at_85%_80%,rgb(var(--violet)/0.06),transparent_70%)]" />

      {/* 3D universe */}
      <div aria-hidden className="absolute inset-0 -z-10 lg:left-[30%]">
        {webgl === false ? (
          <HeroFallback />
        ) : webgl ? (
          <ErrorBoundary region="3D scene" fallback={<HeroFallback />}>
            <Suspense fallback={null}>
              <motion.div className="h-full w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6, ease }}>
                <HeroScene active={inView} reducedMotion={reduced} compact={compact} />
              </motion.div>
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </div>
      {/* Legibility veil — keeps the headline crisp over the scene */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(var(--void))_0%,rgb(var(--void)/0.85)_28%,rgb(var(--void)/0.1)_60%,transparent_100%)] max-lg:bg-[linear-gradient(180deg,rgb(var(--void)/0.2)_0%,rgb(var(--void)/0.7)_55%,rgb(var(--void))_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-void to-transparent" />

      <div className="mx-auto w-full max-w-[1240px] px-5 pb-24 pt-32 md:px-8">
        <div className="max-w-[640px]">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.1 }} className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-line-strong/80 bg-deep/60 py-1 pl-1.5 pr-3 backdrop-blur">
            <span className="rounded-full bg-cyan/10 px-2 py-0.5 font-display text-2xs font-semibold uppercase tracking-[0.14em] text-cyan">ASTRION</span>
            <span className="text-xs text-ink-muted">The Living Intelligence Engine</span>
          </motion.div>

          <h1 id="hero-title" className="font-display text-[2.9rem] font-medium leading-[1.02] tracking-[-0.035em] text-ink sm:text-6xl lg:text-[5.1rem]">
            <motion.span className="block" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease, delay: 0.2 }}>
              Knowledge is not static.
            </motion.span>
            <motion.span
              className="block text-cyan [text-shadow:0_0_40px_rgb(var(--cyan)/0.35)]"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease, delay: 0.38 }}
            >
              It evolves.
            </motion.span>
          </h1>

          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.6 }} className="mt-7 max-w-[520px] text-[1.05rem] leading-relaxed text-ink-muted md:text-lg">
            An intelligent universe that connects information, discovers hidden relationships, and transforms evidence into new possibilities.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.78 }} className="mt-10 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/app/universe" variant="primary" size="lg" className="group">
              Enter the Universe
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </ButtonLink>
            <a
              href="#architecture"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-line-strong bg-deep/40 px-6 text-[0.95rem] font-medium text-ink backdrop-blur transition-colors hover:border-cyan/60 hover:text-cyan"
            >
              Explore the Intelligence
            </a>
          </motion.div>

          <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.1 }} className="mt-14 grid max-w-[520px] grid-cols-3 gap-6 border-t border-line/80 pt-6">
            {[
              ['Traceable', 'Every claim tied to evidence'],
              ['Explainable', 'Hypotheses never pose as facts'],
              ['Evolving', 'Knowledge updates as evidence arrives'],
            ].map(([t, d]) => (
              <div key={t}>
                <dt className="font-display text-sm font-medium text-ink">{t}</dt>
                <dd className="mt-1 text-xs leading-relaxed text-ink-faint">{d}</dd>
              </div>
            ))}
          </motion.dl>
        </div>
      </div>

      <div aria-hidden className="absolute bottom-6 right-6 hidden items-center gap-3 text-2xs uppercase tracking-[0.16em] text-ink-faint lg:flex">
        <span className="h-px w-10 bg-line-strong" /> Interactive — move your pointer
      </div>
      <a href="#problem" aria-label="Scroll to next section" className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full p-2 text-ink-faint transition-colors hover:text-ink">
        <ChevronDown size={18} className="animate-bounce" style={{ animationDuration: '2.4s' }} />
      </a>
    </section>
  );
}
