import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';
import { installGlobalErrorReporting } from './lib/errorReporting';

installGlobalErrorReporting();

// A deploy renames lazy-loaded chunk files (Vite content-hashes them), so a
// tab left open across a deploy can try to fetch a chunk that no longer
// exists on the server once the user navigates to a not-yet-loaded screen.
// Reload once to pick up the current build. The guard is a timestamp (not a
// one-shot flag cleared on boot) and deliberately survives the reload via
// sessionStorage, so a chunk that is still missing after the fresh load
// (real outage, not a stale reference) falls through to the ErrorBoundary
// instead of reload-looping forever; a genuinely new stale-chunk error
// later in the same tab still gets its own retry once the cooldown passes.
const CHUNK_RELOAD_GUARD_KEY = 'vite-chunk-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 15000;
const reloadForStaleChunk = (): void => {
  const lastAttempt = Number(sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) || 0);
  if (Date.now() - lastAttempt < CHUNK_RELOAD_COOLDOWN_MS) return;
  sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
};
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadForStaleChunk();
});
window.addEventListener('unhandledrejection', (event) => {
  if (/failed to fetch dynamically imported module|error loading dynamically imported module/i.test(String(event.reason?.message || event.reason || ''))) {
    reloadForStaleChunk();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <LanguageProvider>
            <App />
          </LanguageProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
