import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/brand/Logo';
import { NAV_ITEMS } from '@/app/navigation';
import { LandingNav } from './components/LandingNav';
import { Hero } from './hero/Hero';
import { ArchitectureSection } from './sections/ArchitectureSection';
import { DiscoverySection } from './sections/DiscoverySection';
import { ExploreSection } from './sections/ExploreSection';
import { FinalCta } from './sections/FinalCta';
import { IntelligenceSection } from './sections/IntelligenceSection';
import { ProblemSection } from './sections/ProblemSection';

function Footer() {
  return (
    <footer className="border-t border-line/60 py-12">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 md:flex-row md:items-start md:justify-between md:px-8">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">The Living Intelligence Engine. Phase 1 — product foundation. All graph, agent and discovery content on this page is illustrative sample data.</p>
        </div>
        <nav aria-label="Application">
          <p className="eyebrow mb-3">Environments</p>
          <ul className="grid grid-cols-2 gap-x-10 gap-y-2">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="text-[0.8rem] text-ink-muted hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  useEffect(() => {
    document.title = 'ASTRION — The Living Intelligence Engine';
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  return (
    <div className="min-h-screen bg-void">
      <LandingNav />
      <main>
        <Hero />
        <ProblemSection />
        <ArchitectureSection />
        <ExploreSection />
        <IntelligenceSection />
        <DiscoverySection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
