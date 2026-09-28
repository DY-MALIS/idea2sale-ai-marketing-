import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientError } from '../lib/errorReporting';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// A lazy-loaded route's chunk filename is content-hashed and changes on every
// deploy. A tab left open across a deploy still holds index.html referencing
// the *old* hashes, so navigating to a not-yet-visited lazy route re-fetches a
// chunk the CDN no longer serves -- surfacing as this exact TypeError, not a
// network error, because the failed dynamic import resolves to undefined
// instead of throwing. Reloading once fetches the new index.html/chunks and
// fixes it silently instead of showing the user a scary crash screen for
// something that isn't a real bug.
//
// A cooldown window (not a one-shot flag) tracks the last auto-reload time:
// this deploy might not be the only one in a long-lived tab's session, so a
// plain "already reloaded once" flag would only fix the first deploy the tab
// lives through and show the scary crash screen for every one after. If the
// same error recurs within the cooldown, though, reloading didn't fix it --
// that's a real bug, not a stale chunk, so it falls through to the manual-
// reload UI below instead of loop-reloading forever.
const CHUNK_LOAD_ERROR_PATTERN = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|reading 'default'/i;
const CHUNK_RELOAD_TIMESTAMP_KEY = 'chunk-error-auto-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 15000;

const withinChunkReloadCooldown = () => {
  const lastReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_TIMESTAMP_KEY) || 0);
  return Date.now() - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS;
};

// Without this, any uncaught error while rendering ANY screen unmounts the entire
// app, leaving a blank or partially-styled page (e.g. only the sidebar's own
// background color showing) with no indication of what happened or how to recover
// — confirmed live: users hitting a broken screen with nothing but a colored
// background and no way to tell what went wrong.
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    if (CHUNK_LOAD_ERROR_PATTERN.test(error.message) && !withinChunkReloadCooldown()) {
      sessionStorage.setItem(CHUNK_RELOAD_TIMESTAMP_KEY, String(Date.now()));
      window.location.reload();
      return { error: null };
    }
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (CHUNK_LOAD_ERROR_PATTERN.test(error.message) && withinChunkReloadCooldown()) {
      // Already handled by the auto-reload above -- no need to alert admins
      // about an artifact of deploying, not a real bug.
      return;
    }
    console.error('Unhandled render error caught by ErrorBoundary:', error, info.componentStack);
    reportClientError('ErrorBoundary', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
          <div className="max-w-lg w-full bg-slate-800 border border-red-500/30 rounded-3xl p-8 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="text-red-400" size={28} />
            </div>
            <h2 className="text-xl font-bold text-white">Something went wrong / មានបញ្ហាកើតឡើង</h2>
            <p className="text-slate-400 text-sm break-words">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-5 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm transition-all"
            >
              <RefreshCw size={16} />
              Reload page / ផ្ទុកទំព័រឡើងវិញ
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
