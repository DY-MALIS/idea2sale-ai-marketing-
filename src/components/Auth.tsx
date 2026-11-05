import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  AlertCircle
} from 'lucide-react';

import { signInWithGoogle, auth, authPersistenceReady } from '../lib/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { useLanguage } from '../contexts/LanguageContext';

interface AuthProps {
  onDemoMode?: () => void;
}

const Auth: React.FC<AuthProps> = ({ onDemoMode }) => {
  const { t, language } = useLanguage();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const firebaseApiKey = import.meta.env.VITE_FIREBASE_API_KEY || '';

  useEffect(() => {
    if (firebaseApiKey !== 'AIzaSyCfsAFKqDFs5k5Na9iYdAjlwIohub1noJI' && error?.includes('suspended')) {
      setError(null);
      setErrorCode(null);
    }
  }, [error, firebaseApiKey]);

  const getFriendlyAuthError = (err: any) => {
    const code = err?.code || '';
    const message = err?.message || '';

    if (code === 'auth/permission-denied' || message.includes('api-key') || message.includes('has-been-suspended')) {
      return language === 'km'
        ? 'Firebase API key ត្រូវបានផ្អាក។ សូមដាក់ Firebase API key ថ្មី។'
        : 'The Firebase API key has been suspended. Please add a new Firebase API key.';
    }

    if (code === 'auth/popup-blocked') {
      return language === 'km'
        ? 'Browser បានទប់ស្កាត់ Google sign-in popup។ សូមអនុញ្ញាត popups។'
        : 'Your browser blocked the Google sign-in popup. Please allow popups.';
    }

    if (code === 'auth/unauthorized-domain') {
      return language === 'km'
        ? 'Firebase មិនទាន់អនុញ្ញាត domain នេះទេ។ សូមបន្ថែម localhost ក្នុង Authentication > Settings > Authorized domains។'
        : 'Firebase has not authorized this domain yet. Add localhost in Authentication > Settings > Authorized domains.';
    }

    return message || (language === 'km' ? 'Google login បរាជ័យ។' : 'Google login failed.');
  };

  const isRecoverableFirebaseError = (code: string | null) => (
    code === 'auth/admin-restricted-operation' ||
    code === 'auth/operation-not-allowed' ||
    code === 'auth/permission-denied'
  );

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error(err);
      const code = err.code || (err.message?.includes('api-key') ? 'auth/permission-denied' : null);
      setErrorCode(code);
      setError(getFriendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrorCode(null);
    if (!isLogin && password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await authPersistenceReady;
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('This email already has an account. Sign in with email if you have a password, or sign in with Google and add one in Business Profile.');
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError('Email/password accounts are not enabled for this project.');
      } else {
        setError(isLogin ? 'Could not sign in. Check your email and password.' : 'Could not create your account. Check your email and password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const selectEmailMode = (login: boolean) => {
    if (isLogin === login) return;
    setIsLogin(login);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setErrorCode(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-mesh px-4 py-20 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src="/favicon.svg"
            alt="aime.angkorgate icon"
            className="mb-4 h-16 w-16 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-black text-brand-700 dark:text-brand-400">aime.angkorgate</h1>
          <p className="text-slate-700 dark:text-slate-300 mt-2 text-lg sm:text-xl font-semibold leading-snug">
            {isLogin ? t('signInToContinue') : t('joinAndGrow')}
          </p>
        </div>

        <div className="glass p-6 sm:p-8 md:p-10 rounded-[2rem] sm:rounded-[3rem] border border-white/70 shadow-2xl">
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" aria-label="Account access">
            <button type="button" disabled={loading} aria-pressed={isLogin} onClick={() => selectEmailMode(true)} className={`rounded-lg px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50 ${isLogin ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-300' : 'text-slate-600 hover:text-brand-700 dark:text-slate-300'}`}>Sign in</button>
            <button type="button" disabled={loading} aria-pressed={!isLogin} onClick={() => selectEmailMode(false)} className={`rounded-lg px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50 ${!isLogin ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-300' : 'text-slate-600 hover:text-brand-700 dark:text-slate-300'}`}>Register</button>
          </div>
          <form onSubmit={handleEmailSubmit} className="mb-6 space-y-3">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{isLogin ? 'Email sign-in' : 'Register with email'}</h2>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200" htmlFor="account-email">Email address</label>
            <input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900" />
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200" htmlFor="account-password">Password</label>
            <input id="account-password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={isLogin ? undefined : 8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900" />
            {!isLogin && (
              <>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200" htmlFor="account-confirm-password">Confirm password</label>
                <input id="account-confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900" />
              </>
            )}
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-brand-700 px-5 py-3 font-bold text-white disabled:opacity-50">{isLogin ? 'Sign in with email' : 'Register with email'}</button>
          </form>
          <div className="space-y-6">
            {error && (
              <div className="space-y-4">
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs text-center leading-relaxed font-medium flex items-center justify-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{error}</span>
                </div>

                {isRecoverableFirebaseError(errorCode) && onDemoMode && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    type="button"
                    onClick={onDemoMode}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold text-xs shadow-xl flex items-center justify-center gap-2 hover:bg-black transition-all"
                  >
                    <Sparkles size={16} className="text-brand-400" />
                    {t('exploreDemo')}
                  </motion.button>
                )}
              </div>
            )}

            {onDemoMode && (
              <p className="text-center text-slate-600 dark:text-slate-300 text-[11px] sm:text-xs font-bold uppercase tracking-wide mt-4 leading-relaxed">
                {t('orTryDemo')} {' '}
                <button
                  type="button"
                  onClick={onDemoMode}
                  className="text-brand-700 dark:text-brand-400 hover:underline inline-flex items-center gap-1"
                >
                  <Sparkles size={12} /> {t('exploreDemo')}
                </button>
              </p>
            )}

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white dark:bg-slate-900 px-4 text-slate-600 dark:text-slate-300 font-bold tracking-widest">{t('orContinueWith')}</span>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="w-full min-h-14 px-5 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-3 transition-all shadow-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-center"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {t('continueWithGoogle')}
            </motion.button>
          </div>
        </div>

        <p className="text-center text-slate-600 dark:text-slate-300 text-[10px] sm:text-xs mt-8 sm:mt-10 leading-relaxed font-semibold uppercase tracking-[0.14em] sm:tracking-widest">
          {t('termsAndPrivacyPrefix')} <br />
          <a href="/terms-of-service/" className="text-brand-700 dark:text-brand-400 font-bold hover:underline">{t('termsOfService')}</a> {t('and')}{' '}
          <a href="/privacy-policy/" className="text-brand-700 dark:text-brand-400 font-bold hover:underline">{t('privacyPolicy')}</a>.
        </p>
      </motion.div>
    </div>
  );
};

export default Auth;
