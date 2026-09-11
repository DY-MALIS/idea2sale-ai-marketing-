import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';

export type GenerationHistoryType = 'video' | 'image' | 'facebook_scan';

export interface GenerationHistoryEntry {
  id: string;
  type: GenerationHistoryType;
  title: string;
  summary?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  payload?: Record<string, unknown>;
  createdAt: number;
}

const HISTORY_LIMIT = 20;
const demoStorageKey = (type: GenerationHistoryType) => `demo_generation_history_${type}`;

const readDemoEntries = (type: GenerationHistoryType): GenerationHistoryEntry[] => {
  try {
    const value = JSON.parse(localStorage.getItem(demoStorageKey(type)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const writeDemoEntries = (type: GenerationHistoryType, entries: GenerationHistoryEntry[]) => {
  localStorage.setItem(demoStorageKey(type), JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
};

interface SaveHistoryArgs {
  user: User | null;
  isDemoMode: boolean;
  type: GenerationHistoryType;
  title: string;
  summary?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  payload?: Record<string, unknown>;
}

export const saveGenerationHistory = async ({
  user, isDemoMode, type, title, summary, mediaUrl, mediaType, payload,
}: SaveHistoryArgs): Promise<void> => {
  const base = {
    type,
    title: title.slice(0, 200),
    ...(summary ? { summary: summary.slice(0, 500) } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(payload ? { payload } : {}),
  };

  if (isDemoMode || !user) {
    const existing = readDemoEntries(type);
    writeDemoEntries(type, [{ ...base, id: `demo-${Date.now()}`, createdAt: Date.now() }, ...existing]);
    return;
  }

  await addDoc(collection(db, 'generation_history'), {
    ...base,
    userId: user.uid,
    createdAt: serverTimestamp(),
  });
};

export const deleteGenerationHistory = async ({
  user, isDemoMode, type, id,
}: { user: User | null; isDemoMode: boolean; type: GenerationHistoryType; id: string }): Promise<void> => {
  if (isDemoMode || !user) {
    writeDemoEntries(type, readDemoEntries(type).filter((entry) => entry.id !== id));
    return;
  }
  await deleteDoc(doc(db, 'generation_history', id));
};

// Filters/sorts client-side after a single-field `userId` query rather than
// adding a second `where('type', ...)` + `orderBy('createdAt', ...)` to the
// Firestore query itself -- that combination needs a composite index created
// in the Firebase console first, which isn't something this codebase can
// deploy automatically. content_plan_items (AIAgent.tsx) already uses this
// same single-field-query-then-sort-in-JS pattern for the same reason.
export const useGenerationHistory = (user: User | null, isDemoMode: boolean, type: GenerationHistoryType): GenerationHistoryEntry[] => {
  const [entries, setEntries] = useState<GenerationHistoryEntry[]>([]);

  useEffect(() => {
    if (isDemoMode || !user) {
      setEntries(readDemoEntries(type));
      return;
    }
    const q = query(collection(db, 'generation_history'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          if (data.type !== type) return null;
          return {
            id: docSnap.id,
            type: data.type,
            title: String(data.title || ''),
            summary: data.summary || undefined,
            mediaUrl: data.mediaUrl || undefined,
            mediaType: data.mediaType || undefined,
            payload: data.payload || undefined,
            createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
          } as GenerationHistoryEntry;
        })
        .filter((entry): entry is GenerationHistoryEntry => entry !== null)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, HISTORY_LIMIT);
      setEntries(rows);
    }, (error) => {
      console.error('Failed to load generation history:', error);
    });
    return unsubscribe;
  }, [user, isDemoMode, type]);

  return entries;
};
