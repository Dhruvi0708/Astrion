import { ButtonLink } from '@/components/ui/Button';
import { LogoMark } from '@/components/brand/Logo';

export function NotFoundPage({ inApp }: { inApp?: boolean }) {
  return (
    <div className={inApp ? 'flex h-[70vh] items-center justify-center p-6' : 'flex min-h-screen items-center justify-center bg-void p-6'}>
      <div className="max-w-md text-center">
        <LogoMark size={40} className="mx-auto opacity-80" />
        <p className="eyebrow mt-6">404 · Uncharted region</p>
        <h1 className="mt-3 font-display text-2xl font-medium">This part of the universe hasn’t been mapped.</h1>
        <p className="mt-2 text-sm text-ink-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink to="/app/overview" variant="primary">
            Go to Overview
          </ButtonLink>
          <ButtonLink to="/" variant="ghost">
            Landing page
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
