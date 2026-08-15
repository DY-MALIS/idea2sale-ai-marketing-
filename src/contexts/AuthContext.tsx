import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { auth, authPersistenceReady } from '../lib/firebase';
import { signInWithCustomToken, User } from 'firebase/auth';
import { getGuestInstallationId, isStableGuestUid } from '../lib/guestIdentity';

interface AuthContextType {
  user: User | null;
  isDemoMode: boolean;
  loading: boolean;
  setDemoMode: (val: boolean) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const stabilizingGuestUid = useRef<string | null>(null);

  useEffect(() => {
    // Absolute last-resort ceiling. App.tsx gates the *entire app* behind
    // `loading`, so if nothing else below ever settles, this is what stands
    // between that and an infinitely stuck spinner. Should never actually need to
    // fire in practice -- the race in the guest-migration branch below is the
    // thing that actually bounds that work -- but it stays armed for the whole
    // callback (not cleared until the callback truly finishes) as a structural
    // guarantee against any future hang added here, not just the ones handled today.
    const timeoutId = window.setTimeout(() => {
      console.warn('Firebase auth state timed out. Showing the sign-in screen.');
      setLoading(false);
    }, 20000);

    const unsubscribe = auth.onAuthStateChanged(
      async (u) => {
        if (u && !isStableGuestUid(u.uid) && stabilizingGuestUid.current !== u.uid) {
          try {
            // Every step here (two Firebase SDK calls, a fetch, a persistence
            // write, a token sign-in) is awaited in sequence with no timeout of
            // its own -- a hang in ANY of them, not just the fetch, would
            // otherwise leave this whole branch (and the app-wide spinner above)
            // stuck forever. Racing the whole attempt against one timeout bounds
            // it structurally regardless of which specific step misbehaves,
            // rather than requiring every current and future step inside to
            // remember to add its own guard.
            const migrated = await Promise.race([
              (async () => {
                const tokenResult = await u.getIdTokenResult();
                if (tokenResult.claims.guest !== true) return false;

                stabilizingGuestUid.current = u.uid;
                const idToken = await u.getIdToken();
                const response = await fetch('/api/telegram/run-scheduled?action=migrate-guest', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    installationId: getGuestInstallationId()
                  })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok || !data.ok || !data.token) {
                  throw new Error(data.error || 'Could not preserve the guest account.');
                }

                await authPersistenceReady;
                await signInWithCustomToken(auth, data.token);
                return true;
              })(),
              new Promise<boolean>((_, reject) => {
                window.setTimeout(() => reject(new Error('Guest account migration timed out.')), 12000);
              }),
            ]);

            if (migrated) {
              window.clearTimeout(timeoutId);
              return;
            }
          } catch (error) {
            console.error('Guest account migration failed; keeping the current session:', error);
          }
        }

        window.clearTimeout(timeoutId);
        setUser(u);
        if (u) setIsDemoMode(false);
        setLoading(false);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        console.error('Firebase auth state failed:', error);
        setUser(null);
        setLoading(false);
      }
    );

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const logout = () => {
    auth.signOut();
    setIsDemoMode(false);
  };

  return (
    <AuthContext.Provider value={{ user, isDemoMode, loading, setDemoMode: setIsDemoMode, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
