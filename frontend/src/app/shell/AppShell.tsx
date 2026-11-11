import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { CreateWorkspaceDialog } from '@/features/workspaces/CreateWorkspaceDialog';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { PageLoader } from './PageLoader';

/** Persistent application frame shared by every environment. */
export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen bg-abyss">
      <a href="#main" className="sr-only z-[100] rounded bg-cyan px-3 py-2 text-void focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <Sidebar />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="relative min-w-0 flex-1">
          <ErrorBoundary key={pathname} region="This environment">
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <CreateWorkspaceDialog />
    </div>
  );
}
