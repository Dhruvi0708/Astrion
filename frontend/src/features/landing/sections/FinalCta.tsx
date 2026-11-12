import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t border-line/60 py-32 md:py-44">
      <div aria-hidden className="hairline-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_50%,black,transparent)]" />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(var(--cyan)/0.09),transparent_62%)]"
      />
      <svg aria-hidden viewBox="0 0 600 600" className="absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 opacity-60">
        <circle cx="300" cy="300" r="180" fill="none" stroke="#1c253d" />
        <circle cx="300" cy="300" r="260" fill="none" stroke="#1c253d" strokeDasharray="2 7" />
        <ellipse cx="300" cy="300" rx="280" ry="96" fill="none" stroke="#4fe3f0" strokeOpacity="0.16" transform="rotate(-18 300 300)" />
        <circle cx="560" cy="215" r="3" fill="#4fe3f0" />
        <circle cx="68" cy="370" r="2.5" fill="#9d8cff" />
      </svg>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="relative mx-auto max-w-3xl px-5 text-center"
      >
        <LogoMark size={44} className="mx-auto" />
        <h2 id="cta-title" className="mt-8 font-display text-[2.4rem] font-medium leading-[1.05] tracking-[-0.03em] text-ink md:text-[3.6rem]">
          Step into a universe
          <br />
          <span className="text-ink-muted">where knowledge keeps learning.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl leading-relaxed text-ink-muted">
          The Phase 1 foundation is live: workspaces, source registration, the knowledge-graph explorer and the environments where investigation, discovery and
          simulation will run.
        </p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink to="/app/universe" variant="primary" size="lg" className="group">
            Enter the Universe <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
          </ButtonLink>
          <ButtonLink to="/app/overview" variant="secondary" size="lg">
            Open your workspace
          </ButtonLink>
        </div>
      </motion.div>
    </section>
  );
}
