import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { RouterProvider } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/globals.css';
import { createRouter } from './app/router';
import { onSessionCleared, useAuth } from './features/auth/store';
import { usePreferences } from './stores/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

const router = createRouter();

// Never let one user's cached data survive into another user's session.
onSessionCleared(() => {
  queryClient.clear();
  usePreferences.getState().setActiveWorkspaceId(null);
});
void useAuth.getState().bootstrap();

function Root() {
  const reduceMotion = usePreferences((s) => s.reduceMotion);
  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>
    </MotionConfig>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
