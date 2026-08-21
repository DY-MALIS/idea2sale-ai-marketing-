import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronRight,
  Sparkles,
  Loader2,
  AlertCircle
} from 'lucide-react';

import { signInWithGoogle, auth, authPersistenceReady } from '../lib/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { useLanguage } from '../contexts/LanguageContext';
import { getGuestInstallationId } from '../lib/guestIdentity';

interface AuthProps {
  onDemoMode?: () => void;
}

const Auth: React.FC<AuthProps> = ({ onDemoMode }) => {
  const { t, language } = useLanguage();
  const [isLogin, setIsLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
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
        ? 'Firebase API key ត្រូវបានផ្អាក។ សូមប្រើ Continue as Guest ឬដាក់ Firebase API key ថ្មី។'
        : 'The Firebase API key has been suspended. Please use Continue as Guest or add a new Firebase API key.';
    }

    if (code === 'auth/popup-blocked') {
      return language === 'km'
        ? 'Browser បានទប់ស្កាត់ Google sign-in popup។ សូមអនុញ្ញាត popups ឬប្រើ Continue as Guest។'
        : 'Your browser blocked the Google sign-in popup. Please allow popups or use Continue as Guest.';
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      await authPersistenceReady;
      // Without a bound, a hung response here leaves `loading` stuck true forever
      // (the finally below never runs until this await settles) -- the Continue
      // as Guest button would stay disabled with a permanent spinner.
      const guestTokenController = new AbortController();
      const guestTokenTimeoutId = window.setTimeout(() => guestTokenController.abort(), 15000);
      let response: Response;
      try {
        response = await fetch('/api/telegram/run-scheduled?action=guest-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            installationId: getGuestInstallationId()
          }),
          signal: guestTokenController.signal
        });
      } finally {
        window.clearTimeout(guestTokenTimeoutId);
      }
      const responseText = await response.text();
      let data: any = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(`Guest sign-in service returned HTTP ${response.status}.`);
      }

      if (!response.ok || !data.ok || !data.token) {
        throw new Error(data.error || 'Could not start a guest session.');
      }

      await signInWithCustomToken(auth, data.token);
    } catch (err: any) {
      console.error('Guest sign-in failed:', err);
      setErrorCode(err?.code || null);
      setError(
        language === 'km'
          ? `មិនអាចចូលជា Guest បានទេ៖ ${err?.message || 'Unknown error'}`
          : `Could not continue as guest: ${err?.message || 'Unknown error'}`
      );
    } finally {
      setLoading(false);
    }
  };

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
          <form onSubmit={handleSubmit} className="space-y-6">
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

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={loading}
              type="submit"
              className="w-full min-h-16 px-5 py-5 bg-brand-700 text-white rounded-[1.5rem] font-black text-xs sm:text-sm uppercase tracking-[0.14em] sm:tracking-[0.2em] shadow-xl shadow-brand-700/30 hover:bg-brand-800 transition-all flex items-center justify-center gap-3 mt-4 disabled:opacity-50 text-center"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : (
                <>
                  {t('continueAsGuest')}
                  <ChevronRight size={20} />
                </>
              )}
            </motion.button>

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
          </form>

          {/* Account toggle hidden as only supporting Guest and Google for now */}
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
