import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { queryClient } from './lib/queryClient';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element is missing from index.html');
}
const root = createRoot(rootElement);

/**
 * Renders a configuration failure as a visible panel rather than a blank screen.
 *
 * FR-006 requires a missing VITE_API_URL to fail "loudly and early". A console
 * error alone is not loud — the operator starting the app before a rehearsal is
 * looking at the browser, not the devtools.
 */
function renderFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <div className="fatal">
      <h1 className="fatal__title">Guardian cannot start</h1>
      <p className="fatal__message">{message}</p>
    </div>,
  );
}

/**
 * `./config` validates at module load and throws on bad configuration, which a
 * static import could not catch. The dynamic import keeps the fail-fast property
 * while letting us render the failure.
 */
async function bootstrap(): Promise<void> {
  try {
    await import('./config');
  } catch (error) {
    renderFatal(error);
    return;
  }

  const { AppRoutes } = await import('./routes/AppRoutes');

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
