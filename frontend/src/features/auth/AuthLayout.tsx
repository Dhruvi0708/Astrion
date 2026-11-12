import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo, LogoMark } from '@/components/brand/Logo';

/** Split layout for sign-in screens: a quiet constellation beside the form, in ASTRION's visual language. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-void">
      <aside aria-hidden className="relative hidden w-[44%] overflow-hidden border-r border-line/60 lg:block">
        <div className="hairline-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(var(--cyan)/0.08),transparent_62%)]" />
        <svg viewBox="0 0 600 600" className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2">
          <circle cx="300" cy="300" r="170" fill="none" stroke="#1c253d" />
          <circle cx="300" cy="300" r="250" fill="none" stroke="#1c253d" strokeDasharray="2 7" />
          <ellipse cx="300" cy="300" rx="260" ry="88" fill="none" stroke="#4fe3f0" strokeOpacity="0.18" transform="rotate(-18 300 300)" />
          {[
            [470, 230, '#4fe3f0'],
            [150, 360, '#9d8cff'],
            [380, 450, '#e6ecf6'],
            [210, 170, '#4fe3f0'],
          ].map(([x, y, c], i) => (
            <g key={i}>
              <line x1="300" y1="300" x2={x as number} y2={y as number} stroke={c as string} strokeOpacity="0.22" />
              <circle cx={x as number} cy={y as number} r="3.5" fill={c as string} />
            </g>
          ))}
          <circle cx="300" cy="300" r="26" fill="#4fe3f0" fillOpacity="0.08" stroke="#4fe3f0" strokeOpacity="0.5" />
          <circle cx="300" cy="300" r="7" fill="#4fe3f0" />
        </svg>
        <div className="absolute bottom-10 left-10 right-10">
          <p className="font-display text-2xl font-medium leading-snug text-ink">
            Every claim traceable.
            <br />
            <span className="text-ink-muted">Every workspace private to you.</span>
          </p>
        </div>
      </aside>
      <main className="flex flex-1 flex-col px-5 py-8 md:px-10">
        <Link to="/" aria-label="ASTRION home" className="self-start rounded">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">
            <LogoMark size={34} className="mb-6" />
            <h1 className="font-display text-[1.75rem] font-medium tracking-tight text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <div className="mt-6 text-sm text-ink-muted">{footer}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
