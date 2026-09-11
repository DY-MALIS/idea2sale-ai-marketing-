import React, { useState } from 'react';
import { ChevronDown, Clock3, RotateCcw, Trash2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { GenerationHistoryEntry } from '../lib/generationHistory';

interface HistoryPanelProps {
  entries: GenerationHistoryEntry[];
  onRestore: (entry: GenerationHistoryEntry) => void;
  onDelete: (id: string) => void;
}

const formatTimestamp = (ms: number, isKm: boolean) => {
  try {
    return new Date(ms).toLocaleString(isKm ? 'km-KH' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const HistoryPanel: React.FC<HistoryPanelProps> = ({ entries, onRestore, onDelete }) => {
  const { language } = useLanguage();
  const isKm = language === 'km';
  const [open, setOpen] = useState(false);

  if (!entries.length) return null;

  const text = isKm ? {
    title: 'ប្រវត្តិ',
    count: (n: number) => `${n} ការបង្កើតពីមុន`,
    restore: 'មើលឡើងវិញ',
    delete: 'លុប',
  } : {
    title: 'History',
    count: (n: number) => `${n} past generation${n === 1 ? '' : 's'}`,
    restore: 'View',
    delete: 'Delete',
  };

  return (
    <div className="glass rounded-2xl p-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
          <Clock3 size={16} className="text-brand-500" />
          {text.title}
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">{text.count(entries.length)}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              {entry.mediaUrl && entry.mediaType === 'photo' && (
                <img src={entry.mediaUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              )}
              {entry.mediaUrl && entry.mediaType === 'video' && (
                <video src={entry.mediaUrl} className="h-12 w-12 shrink-0 rounded-lg object-cover" muted />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">{entry.title || '—'}</p>
                <p className="text-xs text-slate-400">{formatTimestamp(entry.createdAt, isKm)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRestore(entry)}
                title={text.restore}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300"
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(entry.id)}
                title={text.delete}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HistoryPanel;
