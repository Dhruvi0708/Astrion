import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Home, Orbit, Plus, Search, type LucideIcon } from 'lucide-react';
import { NODE_KIND_LABEL, sampleGraph } from '@/data/sample/graph';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';
import { NAV_ITEMS } from '../navigation';

interface CommandItem {
  id: string;
  group: 'Navigate' | 'Actions' | 'Sample graph';
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

/** Global command launcher (⌘K / Ctrl+K). Every entry performs a real navigation or action. */
export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setOpen = useUi((s) => s.setCommandOpen);
  const openCreate = useUi((s) => s.setCreateWorkspaceOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUi.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const go = (to: string) => () => navigate(to);
    return [
      ...NAV_ITEMS.map((item) => ({ id: item.to, group: 'Navigate' as const, label: item.label, hint: item.description, icon: item.icon, run: go(item.to) })),
      { id: 'home', group: 'Navigate', label: 'Landing page', hint: 'Return to the ASTRION introduction', icon: Home, run: go('/') },
      { id: 'create-ws', group: 'Actions', label: 'Create workspace', hint: 'Creates a workspace via the API', icon: Plus, run: () => openCreate(true) },
      { id: 'register-source', group: 'Actions', label: 'Register a source', hint: 'Open Sources and add metadata', icon: Plus, run: go('/app/sources?new=1') },
      ...sampleGraph.nodes.map((node) => ({
        id: `node-${node.id}`,
        group: 'Sample graph' as const,
        label: node.label,
        hint: `${NODE_KIND_LABEL[node.kind]} · open in Universe Explorer`,
        icon: Orbit,
        run: go(`/app/universe?node=${node.id}`),
      })),
    ];
  }, [navigate, openCreate]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term ? items.filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(term)) : items.filter((i) => i.group !== 'Sample graph');
    return list.slice(0, 40);
  }, [items, q]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (item: CommandItem | undefined) => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[index]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  let lastGroup = '';
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[14vh]">
          <motion.div className="fixed inset-0 bg-void/75 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command launcher"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="panel relative w-full max-w-xl overflow-hidden bg-surface"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={16} className="text-ink-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Jump to an environment, run an action, or find a sample node…"
                aria-label="Command search"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-activedescendant={filtered[index] ? `cmd-${filtered[index].id}` : undefined}
                className="h-12 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <kbd className="rounded border border-line-strong px-1.5 font-mono text-2xs text-ink-faint">Esc</kbd>
            </div>
            <ul ref={listRef} id="command-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
              {filtered.length === 0 && <li className="px-3 py-8 text-center text-[0.8rem] text-ink-muted">No matches for “{q}”.</li>}
              {filtered.map((item, i) => {
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <li key={item.id} role="presentation">
                    {header && <p className="eyebrow px-2.5 pb-1 pt-2.5">{header}</p>}
                    <button
                      id={`cmd-${item.id}`}
                      role="option"
                      aria-selected={i === index}
                      data-index={i}
                      onMouseMove={() => setIndex(i)}
                      onClick={() => run(item)}
                      className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', i === index ? 'bg-raised' : '')}
                    >
                      <item.icon size={15} className={i === index ? 'text-cyan' : 'text-ink-faint'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.82rem] text-ink">{item.label}</span>
                        {item.hint && <span className="block truncate text-2xs text-ink-faint">{item.hint}</span>}
                      </span>
                      {i === index && <CornerDownLeft size={13} className="text-ink-faint" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
