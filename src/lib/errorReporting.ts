// Best-effort report of an uncaught frontend error to the developer's admin
// Telegram channel (api/ai.js action=reportClientError -> _alert.js), so a
// real user hitting a broken screen doesn't go unnoticed unless they happen
// to report it themselves. Never throws and never awaited by callers -- a
// failed *report* must not itself become a second visible error.
export const reportClientError = (context: string, error: unknown): void => {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || '' : '';
    void fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reportClientError',
        context,
        message,
        stack,
        url: typeof window !== 'undefined' ? window.location.href : '',
      }),
      // A crash report riding on the same connection as a page navigation/unload
      // can otherwise get silently cancelled -- keepalive lets it finish sending.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting itself must never throw back into the caller's error path.
  }
};

let globalHandlersInstalled = false;

// Installs window-level listeners for the two classes of error a React
// ErrorBoundary structurally cannot catch: exceptions thrown from event
// handlers/timers/etc ("error"), and rejected promises nobody awaited
// ("unhandledrejection"). Safe to call multiple times -- only wires up once.
export const installGlobalErrorReporting = (): void => {
  if (globalHandlersInstalled || typeof window === 'undefined') return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    reportClientError('window.onerror', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportClientError('unhandledrejection', event.reason);
  });
};
