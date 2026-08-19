import React, { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface ToastItem {
  id: number;
  type: 'success' | 'error';
  message: string;
}

const SUCCESS_AUTO_DISMISS_MS = 5000;
// Error toasts used to auto-dismiss at the same 5s as success ones -- for a
// user who isn't already looking at the screen (or doesn't have DevTools open
// to check the console), that's often not enough time to even read the
// message, let alone screenshot it for support. They stay up until manually
// closed instead; success toasts still clear themselves since there's nothing
// to act on.
const ERROR_AUTO_DISMISS_MS = null;

// Lightweight in-app replacement for alert()/window.alert. Each component that
// needs toasts calls useToast() and renders <ToastHost /> once in its JSX.
export const useToast = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    const dismissAfter = type === 'error' ? ERROR_AUTO_DISMISS_MS : SUCCESS_AUTO_DISMISS_MS;
    if (dismissAfter !== null) {
      setTimeout(() => dismiss(id), dismissAfter);
    }
  }, [dismiss]);

  // Defining a component inline in a hook body gives it a brand-new function
  // identity on every render of whatever calls useToast() -- React then treats
  // <ToastHost /> as a different component type each time and unmounts +
  // remounts the whole subtree, which discards AnimatePresence's exit
  // animations and makes a visible toast flicker/reset on every unrelated
  // state change in the parent (e.g. typing in a textarea next to it).
  // useCallback keyed on `toasts` keeps the identity stable across every
  // render that doesn't actually change the toast list.
  const ToastHost: React.FC = useCallback(() => (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg whitespace-pre-line',
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800'
            )}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            ) : (
              <XCircle size={18} className="mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
            {toast.type === 'error' && (
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-md p-0.5 text-red-400 transition hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                title="Close"
              >
                <X size={16} />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  ), [toasts, dismiss]);

  return { notify, ToastHost };
};
