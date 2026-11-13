import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { AppShell } from './shell/AppShell';
import { NotFoundPage } from './NotFoundPage';

// Route-level code splitting: heavy environments (and the 3D landing) load on demand.
const LandingPage = lazy(() => import('@/features/landing/LandingPage'));
const OverviewPage = lazy(() => import('@/features/overview/OverviewPage'));
const UniverseExplorerPage = lazy(() => import('@/features/universe/UniverseExplorerPage'));
const InvestigationRoomPage = lazy(() => import('@/features/investigation/InvestigationRoomPage'));
const InvestigationsPage = lazy(() => import('@/features/workbench/InvestigationsPage'));
const InvestigationWorkbenchPage = lazy(() => import('@/features/workbench/InvestigationWorkbenchPage'));
const IntelligenceNetworkPage = lazy(() => import('@/features/agents/IntelligenceNetworkPage'));
const DiscoveryLabPage = lazy(() => import('@/features/discovery/DiscoveryLabPage'));
const SimulationLabPage = lazy(() => import('@/features/simulation/SimulationLabPage'));
const SourcesPage = lazy(() => import('@/features/sources/SourcesPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const LoginPage = lazy(() => import('@/features/auth/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/features/auth/AuthPages').then((m) => ({ default: m.RegisterPage })));

const authScreen = (node: React.ReactNode) => (
  <ErrorBoundary region="Sign-in">
    <Suspense fallback={<div className="min-h-screen bg-void" />}>{node}</Suspense>
  </ErrorBoundary>
);

export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <ErrorBoundary region="The landing page">
        <Suspense fallback={<div className="min-h-screen bg-void" />}>
          <LandingPage />
        </Suspense>
      </ErrorBoundary>
    ),
  },
  { path: '/login', element: authScreen(<LoginPage />) },
  { path: '/register', element: authScreen(<RegisterPage />) },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/app/overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'universe', element: <UniverseExplorerPage /> },
      { path: 'investigations', element: <InvestigationsPage /> },
      { path: 'investigations/sample', element: <InvestigationRoomPage /> },
      { path: 'investigations/:id', element: <InvestigationWorkbenchPage /> },
      { path: 'intelligence', element: <IntelligenceNetworkPage /> },
      { path: 'discovery', element: <DiscoveryLabPage /> },
      { path: 'simulation', element: <SimulationLabPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage inApp /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const routerFuture = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

export const createRouter = () => createBrowserRouter(routes, { future: routerFuture });
