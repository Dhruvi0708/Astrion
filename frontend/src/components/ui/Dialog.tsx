import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Accessible modal dialog: focus moves in on open, Escape closes, focus returns on close, Tab is trapped. */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
      first?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
          <motion.div
            className="fixed inset-0 bg-void/75 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn('panel relative w-full max-w-lg bg-surface', className)}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 id={titleId} className="font-display text-base font-medium">
                  {title}
                </h2>
                {description && <p className="mt-1 text-[0.8rem] text-ink-muted">{description}</p>}
              </div>
              <button data-close onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-ink-faint hover:bg-raised hover:text-ink">
                <X size={16} />
              </button>
            </header>
            <div className="px-5 py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
