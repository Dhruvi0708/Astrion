import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog' }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
  label: string;
}

/** Lightweight anchored popover with outside-click and Escape dismissal. */
export function Popover({ trigger, children, align = 'end', side = 'bottom', className, label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'panel absolute z-50 w-72 bg-surface',
              side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
              align === 'end' ? 'right-0' : 'left-0',
              className,
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
