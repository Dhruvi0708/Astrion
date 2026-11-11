import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export function SectionIntro({ index, eyebrow, title, children, className, align = 'left', id }: { index: string; eyebrow: string; title: ReactNode; children?: ReactNode; className?: string; align?: 'left' | 'center'; id: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}
    >
      <p className={cn('flex items-center gap-3 font-display text-2xs font-medium uppercase tracking-[0.2em] text-ink-faint', align === 'center' && 'justify-center')}>
        <span className="font-mono text-cyan">{index}</span>
        <span className="h-px w-8 bg-line-strong" />
        {eyebrow}
      </p>
      <h2 id={id} className="mt-5 font-display text-[2rem] font-medium leading-[1.08] tracking-[-0.025em] text-ink md:text-[2.75rem]">
        {title}
      </h2>
      {children && <div className="mt-5 text-[1.02rem] leading-relaxed text-ink-muted">{children}</div>}
    </motion.div>
  );
}
