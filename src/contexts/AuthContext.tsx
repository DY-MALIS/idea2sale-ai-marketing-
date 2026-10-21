import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { User } from 'firebase/auth';
import { clearDemoWorkspace } from '../lib/demoWorkspace';

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

  useEffect(() => {
    // Absolute last-resort ceiling. App.tsx gates the *entire app* behind
    // `loading`, so if nothing else below ever settles, this is what stands
    // between that and an infinitely stuck spinner. Should never actually need to
    // fire in practice, but stays armed so a stalled Firebase callback cannot
    // leave the app behind a loading screen indefinitely.
    const timeoutId = window.setTimeout(() => {
      console.warn('Firebase auth state timed out. Showing the sign-in screen.');
      setLoading(false);
    }, 20000);

    const unsubscribe = auth.onAuthStateChanged(
      (u) => {
        window.clearTimeout(timeoutId);
        setUser(u);
        if (u) {
          clearDemoWorkspace();
          setIsDemoMode(false);
        }
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
    if (isDemoMode) clearDemoWorkspace();
    auth.signOut();
    setIsDemoMode(false);
  };

  const setDemoMode = (val: boolean) => {
    if (val && !isDemoMode) {
      clearDemoWorkspace();
    }
    setIsDemoMode(val);
  };

  return (
    <AuthContext.Provider value={{ user, isDemoMode, loading, setDemoMode, logout }}>
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
