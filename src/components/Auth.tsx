import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle, Check, LockKeyhole, Sparkles } from 'lucide-react';

import { signInWithGoogle } from '../lib/firebase';
import { useLanguage } from '../contexts/LanguageContext';
import AuthShowcase from './AuthShowcase';

const Auth = () => {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const isKhmer = language === 'km';
  const copy = isKhmer ? {
    eyebrow: 'វេទិកាបង្កើតមាតិកាទីផ្សារដោយ AI',
    headline: 'បម្លែងគំនិតសាមញ្ញ ទៅជា',
    headlineAccent: 'មាតិកាដ៏ទាក់ទាញ',
    description: 'Aime ជួយអ្នកបង្កើតអត្ថបទ រូបភាព និងវីដេអូផ្សព្វផ្សាយ ព្រមទាំងរៀបចំផែនការបង្ហោះក្នុងកន្លែងតែមួយ។',
    welcome: 'ស្វាគមន៍មកកាន់ Aime',
    signInDescription: 'ចូលប្រើដើម្បីបង្កើតមាតិកាសម្រាប់អាជីវកម្មអ្នក។',
    secure: 'ចូលប្រើដោយសុវត្ថិភាពតាម Google',
    signInLabel: 'កន្លែងចាប់ផ្តើមរបស់អ្នក',
    journey: 'ចាប់ផ្តើមពីគំនិតរបស់អ្នក ហើយបង្កើតមាតិកាដែលត្រៀមប្រើប្រាស់។',
  } : {
    eyebrow: 'AI CREATIVE MARKETING PLATFORM',
    headline: 'Turn a simple idea into',
    headlineAccent: 'powerful content.',
    description: 'Aime helps you write campaigns, create visuals and videos, and plan your social content in one place.',
    welcome: 'Welcome to Aime',
    signInDescription: 'Sign in to start creating for your business.',
    secure: 'Secure sign-in with Google',
    signInLabel: 'YOUR CREATIVE SPACE',
    journey: 'Bring your idea. Leave with content ready to share.',
  };

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

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error(err);
      setError(getFriendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={`min-h-screen overflow-hidden bg-[#14172f] text-white ${isKhmer ? 'font-khmer' : ''}`}>
      <div className="mx-auto grid min-h-screen max-w-[1700px] md:grid-cols-[minmax(0,1.12fr)_minmax(370px,0.88fr)]">
        <section className="relative flex min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_75%_12%,#55405d_0%,transparent_35%),linear-gradient(145deg,#171a3d_0%,#1d1b3e_52%,#352244_100%)] px-6 pb-8 pt-7 sm:px-10 md:px-8 md:pb-10 md:pt-9 lg:px-14 xl:px-20">
          <div className="pointer-events-none absolute -left-24 top-36 h-72 w-72 rounded-full bg-orange-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 top-10 h-80 w-80 rounded-full border border-orange-300/10" />
          <div className="relative z-10 flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-xl shadow-[0_8px_26px_rgba(245,158,11,0.25)]" />
            <span className="font-display text-xl font-bold tracking-tight text-white">aime<span className="text-orange-300">.</span>angkorgate</span>
          </div>

          <div className="relative z-10 mt-9 max-w-2xl md:mt-12 lg:mt-14">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-300/40 bg-orange-300/10 px-3.5 py-1.5 text-[11px] font-bold tracking-[0.12em] text-orange-100 shadow-[0_0_28px_rgba(251,146,60,0.12)]">
              <Sparkles size={14} aria-hidden="true" /> {copy.eyebrow}
            </p>
            <h1 className={`max-w-[720px] text-[clamp(2.15rem,4.2vw,4.5rem)] font-extrabold leading-[1.08] tracking-tight text-white ${isKhmer ? 'font-khmer leading-[1.35]' : 'font-display'}`}>
              {copy.headline}{' '}<span className="bg-gradient-to-r from-[#ffae64] via-[#ff8a46] to-[#ffca82] bg-clip-text text-transparent">{copy.headlineAccent}</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-white/75 sm:text-base lg:text-lg lg:leading-8">
              {copy.description}
            </p>
          </div>

          <AuthShowcase />
        </section>

        <section className="relative flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#625171_0%,transparent_36%),linear-gradient(145deg,#28223f,#171b36)] px-5 py-8 sm:px-8 md:py-9 lg:px-14">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-orange-400/15 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl" />
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative w-full max-w-md rounded-[2.25rem] border border-white/90 bg-white px-6 py-8 text-slate-900 shadow-[0_35px_100px_-30px_rgba(0,0,0,0.65)] sm:px-8 sm:py-10"
          >
            <div className="mb-7 text-center">
              <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-100 bg-[#fff8ed] shadow-[0_12px_26px_-14px_rgba(154,74,10,0.55)]">
                <img src="/favicon.svg" alt="" className="h-12 w-12" />
              </span>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#b45309]">{copy.signInLabel}</p>
              <h2 className={`text-3xl font-bold leading-tight text-[#171a36] sm:text-[2.6rem] ${isKhmer ? 'font-khmer' : 'font-display'}`}>{copy.welcome}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{copy.signInDescription}</p>
            </div>

            <div className="space-y-4">
            {error && (
              <div role="alert">
                <div className="flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center text-xs font-medium leading-relaxed text-red-600">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            )}

            <motion.button
              whileHover={reduceMotion ? undefined : { scale: 1.02 }}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border border-orange-300 bg-gradient-to-r from-[#ff9e20] via-[#f97b10] to-[#e65f06] px-5 py-4 text-center text-sm font-bold text-white shadow-[0_12px_26px_-10px_rgba(234,100,7,0.8)] transition-all hover:brightness-110 hover:shadow-[0_16px_30px_-9px_rgba(234,100,7,0.9)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm"><svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg></span>
              {t('continueWithGoogle')}
            </motion.button>
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500"><LockKeyhole size={13} aria-hidden="true" />{copy.secure}</p>
            </div>

            <div className="mt-7 flex items-start gap-3 rounded-2xl border border-orange-100 bg-[#fff6e8] px-4 py-3.5 text-sm leading-6 text-[#74523b]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#b45309] text-white"><Check size={12} aria-hidden="true" /></span>
              <span>{copy.journey}</span>
            </div>

            <p className="mt-7 text-center text-xs leading-6 text-slate-500">
              {t('termsAndPrivacyPrefix')}{' '}
              <a href="/terms-of-service/" className="font-semibold text-[#a94d0b] underline-offset-4 hover:underline">{t('termsOfService')}</a> {t('and')}{' '}
              <a href="/privacy-policy/" className="font-semibold text-[#a94d0b] underline-offset-4 hover:underline">{t('privacyPolicy')}</a>.
            </p>
          </motion.div>
        </section>
      </div>
    </main>
  );
};

export default Auth;
