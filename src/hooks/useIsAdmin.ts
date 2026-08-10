import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

// Mirrors firestore.rules' isAdmin(): an admins/{uid} document must exist.
export const useIsAdmin = () => {
  const { user, isDemoMode } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isDemoMode) {
      setIsAdmin(true);
      setChecking(false);
      return;
    }

    if (!user) {
      setIsAdmin(false);
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);
    getDoc(doc(db, 'admins', user.uid))
      .then((snapshot) => {
        if (!cancelled) setIsAdmin(snapshot.exists());
      })
      .catch((error) => {
        console.error('Admin status check failed:', error);
        if (!cancelled) setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, isDemoMode]);

  return { isAdmin, checking };
};
