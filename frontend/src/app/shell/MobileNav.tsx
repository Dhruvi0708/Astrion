import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { useUi } from '@/stores/ui';
import { SidebarNav } from './Sidebar';
import { WorkspaceSelector } from './WorkspaceSelector';

export function MobileNav() {
  const open = useUi((s) => s.mobileNavOpen);
  const setOpen = useUi((s) => s.setMobileNavOpen);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname, setOpen]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <motion.div
            className="absolute inset-0 bg-void/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-y-0 left-0 flex w-[272px] flex-col border-r border-line bg-abyss"
          >
            <div className="flex h-[52px] items-center justify-between border-b border-line px-4">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded p-1.5 text-ink-muted hover:bg-raised">
                <X size={16} />
              </button>
            </div>
            <div className="px-2.5 pt-3">
              <WorkspaceSelector />
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
