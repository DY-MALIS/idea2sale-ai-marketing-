import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CalendarDays, Sparkles, WandSparkles } from 'lucide-react';

import { signInWithGoogle } from '../lib/firebase';
import { useLanguage } from '../contexts/LanguageContext';

const Auth = () => {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isKhmer = language === 'km';
  const copy = isKhmer ? {
    eyebrow: 'កន្លែងបង្កើតមាតិកាសម្រាប់អាជីវកម្មអ្នក',
    headline: 'ពីគំនិតតូចមួយ ទៅជាមាតិកាដែលគេចង់មើល',
    description: 'Aime ជួយអ្នកបង្កើតអត្ថបទ រូបភាព និងវីដេអូផ្សព្វផ្សាយ ព្រមទាំងរៀបចំផែនការបង្ហោះក្នុងកន្លែងតែមួយ។',
    create: 'បង្កើតមាតិកាដោយ AI',
    design: 'រចនារូបភាព និងវីដេអូ',
    plan: 'រៀបចំផែនការផ្សព្វផ្សាយ',
    imageCaption: 'ធ្វើឱ្យផលិតផលរបស់អ្នកលេចធ្លោ',
    welcome: 'ចាប់ផ្តើមជាមួយ Aime',
    signInDescription: 'ចូលប្រើដើម្បីបង្កើតមាតិកាសម្រាប់អាជីវកម្មអ្នក។',
    secure: 'ចូលប្រើដោយសុវត្ថិភាពតាម Google',
  } : {
    eyebrow: 'YOUR CREATIVE MARKETING SPACE',
    headline: 'Turn a simple idea into content people notice.',
    description: 'Aime helps you write campaigns, create visuals and videos, and plan your social content in one place.',
    create: 'Create with AI',
    design: 'Make images & videos',
    plan: 'Plan your content',
    imageCaption: 'Make every product worth a closer look',
    welcome: 'Make something great.',
    signInDescription: 'Sign in to start creating for your business.',
    secure: 'Secure sign-in with Google',
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
    <main className={`min-h-screen overflow-hidden bg-[#fffaf0] text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${isKhmer ? 'font-khmer' : ''}`}>
      <div className="mx-auto grid min-h-screen max-w-[1600px] md:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <section className="relative flex flex-col overflow-hidden bg-gradient-to-br from-[#fff4dc] via-[#fffaf0] to-[#f7e3c4] px-6 pb-7 pt-7 dark:from-slate-900 dark:via-slate-900 dark:to-amber-950/50 sm:px-10 md:px-8 md:pb-10 md:pt-9 lg:px-14 xl:px-20">
          <div className="pointer-events-none absolute -left-24 top-36 h-72 w-72 rounded-full bg-amber-300/25 blur-3xl" />
          <div className="relative z-10 flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-xl shadow-md" />
            <span className="font-display text-xl font-bold tracking-tight text-[#a94d0b] dark:text-amber-300">aime.angkorgate</span>
          </div>

          <div className="relative z-10 mt-8 max-w-2xl md:mt-10 lg:mt-14">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-white/75 px-3 py-1.5 text-[11px] font-bold tracking-[0.12em] text-[#9a4a0a] shadow-sm dark:bg-slate-800/80 dark:text-amber-300">
              <Sparkles size={14} aria-hidden="true" /> {copy.eyebrow}
            </p>
            <h1 className={`max-w-[680px] text-[clamp(2rem,4vw,4.25rem)] font-extrabold leading-[1.1] tracking-tight text-[#4b260d] dark:text-white ${isKhmer ? 'font-khmer leading-[1.35]' : 'font-display'}`}>
              {copy.headline}
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#6d5644] dark:text-slate-300 sm:text-base lg:text-lg lg:leading-8">
              {copy.description}
            </p>
            <ul className="mt-6 flex flex-wrap gap-2.5 text-xs font-semibold text-[#704b2b] dark:text-amber-100 sm:text-sm">
              <li className="flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-2 shadow-sm dark:bg-white/10"><WandSparkles size={16} aria-hidden="true" />{copy.create}</li>
              <li className="flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-2 shadow-sm dark:bg-white/10"><Sparkles size={16} aria-hidden="true" />{copy.design}</li>
              <li className="flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-2 shadow-sm dark:bg-white/10"><CalendarDays size={16} aria-hidden="true" />{copy.plan}</li>
            </ul>
          </div>

          <div className="relative z-10 mt-8 overflow-hidden rounded-[1.75rem] border border-white/80 bg-[#d9a675] shadow-[0_24px_70px_-35px_rgba(112,51,10,0.65)] md:mt-auto md:translate-y-1 lg:mt-10">
            <img src="/auth-hero.webp" alt={isKhmer ? 'ផលិតផលជាមួយទូរស័ព្ទ វីដេអូ រូបផ្សព្វផ្សាយ និងប្រតិទិនមាតិកា' : 'Product photography with video, campaign artwork, and a content calendar'} className="h-52 w-full object-cover object-center sm:h-64 md:h-[clamp(230px,32vh,400px)]" fetchPriority="high" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#321b11]/85 via-[#321b11]/35 to-transparent px-5 pb-5 pt-14 text-sm font-semibold text-white sm:text-base">
              {copy.imageCaption}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-white px-6 py-12 dark:bg-slate-950 sm:px-10 md:px-8 lg:px-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <div className="mb-8">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#b45309] dark:text-amber-400">aime.angkorgate</p>
              <h2 className={`text-3xl font-bold leading-tight text-slate-900 dark:text-white sm:text-4xl ${isKhmer ? 'font-khmer' : 'font-display'}`}>{copy.welcome}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">{copy.signInDescription}</p>
            </div>

            <div className="rounded-[1.75rem] border border-amber-100 bg-[#fffcf7] p-5 shadow-[0_16px_50px_-30px_rgba(127,70,14,0.45)] dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <div className="space-y-5">
            {error && (
              <div role="alert" className="space-y-4">
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-600 dark:text-red-400 text-xs text-center leading-relaxed font-medium flex items-center justify-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            )}

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="w-full min-h-14 px-5 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl font-bold text-sm sm:text-base flex items-center justify-center gap-3 transition-all shadow-sm hover:border-amber-300 hover:shadow-md dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-center"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {t('continueWithGoogle')}
            </motion.button>
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">{copy.secure}</p>
              </div>
            </div>

            <p className="mt-8 text-center text-xs leading-6 text-slate-500 dark:text-slate-400">
              {t('termsAndPrivacyPrefix')}{' '}
              <a href="/terms-of-service/" className="font-semibold text-[#a94d0b] underline-offset-4 hover:underline dark:text-amber-400">{t('termsOfService')}</a> {t('and')}{' '}
              <a href="/privacy-policy/" className="font-semibold text-[#a94d0b] underline-offset-4 hover:underline dark:text-amber-400">{t('privacyPolicy')}</a>.
            </p>
          </motion.div>
        </section>
      </div>
    </main>
  );
};

export default Auth;
