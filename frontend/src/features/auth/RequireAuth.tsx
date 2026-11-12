import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '@/app/shell/PageLoader';
import { useAuth } from './store';

/** Guards the application. Unauthenticated visitors go to /login and come back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-abyss">
        <PageLoader label="Restoring session" />
      </div>
    );
  }
  if (status !== 'authenticated') {
    const next = encodeURIComponent(location.pathname + location.search);
    const reason = status === 'expired' ? '&reason=expired' : status === 'offline' ? '&reason=offline' : '';
    return <Navigate to={`/login?next=${next}${reason}`} replace />;
  }
  return <>{children}</>;
}
