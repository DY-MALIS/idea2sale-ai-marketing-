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
// Vite fires this event instead of just rejecting the import -- reload once
// to pick up the current build; the sessionStorage guard stops a real,
// persistent network failure from reload-looping forever.
const RELOAD_GUARD_KEY = 'vite-chunk-reload-attempted';
sessionStorage.removeItem(RELOAD_GUARD_KEY);
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
  sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  event.preventDefault();
  window.location.reload();
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
