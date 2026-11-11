import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/stores/ui';

/** Tracks whether an element is within (or near) the viewport. */
export function useInView<T extends Element>(rootMargin = '0px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, inView] as const;
}

/** Combines the OS-level reduced-motion setting with the in-app preference. */
export function useReducedMotionPreference() {
  const pref = usePreferences((s) => s.reduceMotion);
  const [os, setOs] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const fn = () => setOs(mq.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);
  return pref || os;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const fn = () => setMatches(mq.matches);
    fn();
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, [query]);
  return matches;
}
