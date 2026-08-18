import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientError } from '../lib/errorReporting';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

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
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
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
