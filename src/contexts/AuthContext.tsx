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
    const timeoutId = window.setTimeout(() => {
      console.warn('Firebase auth state timed out. Showing the sign-in screen.');
      setLoading(false);
    }, 8000);

    const unsubscribe = auth.onAuthStateChanged(
      async (u) => {
        window.clearTimeout(timeoutId);

        if (u && !isStableGuestUid(u.uid) && stabilizingGuestUid.current !== u.uid) {
          try {
            const tokenResult = await u.getIdTokenResult();
            if (tokenResult.claims.guest === true) {
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
              return;
            }
          } catch (error) {
            console.error('Guest account migration failed; keeping the current session:', error);
          }
        }

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
