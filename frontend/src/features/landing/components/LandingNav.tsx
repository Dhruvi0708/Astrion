import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const LINKS = [
  ['#problem', 'Problem'],
  ['#architecture', 'Architecture'],
  ['#explore', 'Universe'],
  ['#intelligence', 'Intelligence'],
  ['#discovery', 'Discovery'],
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    fn();
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300',
        scrolled ? 'border-b border-line/70 bg-void/80 backdrop-blur-md' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 md:px-8">
        <Link to="/" aria-label="ASTRION home" className="rounded">
          <Logo />
        </Link>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {LINKS.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="rounded px-3 py-2 text-[0.82rem] text-ink-muted transition-colors hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ButtonLink to="/app/overview" variant="outline" size="sm" className="h-9 px-3.5">
          Open workspace <ArrowUpRight size={14} />
        </ButtonLink>
      </div>
    </header>
  );
}
