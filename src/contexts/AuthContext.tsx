import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { User } from 'firebase/auth';

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
    const timeoutId = window.setTimeout(() => {
      console.warn('Firebase auth state timed out. Showing the sign-in screen.');
      setLoading(false);
    }, 8000);

    const unsubscribe = auth.onAuthStateChanged(
      (u) => {
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
