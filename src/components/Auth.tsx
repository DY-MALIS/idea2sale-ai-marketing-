import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle, ArrowRight, LockKeyhole, Play, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';

import { signInWithGoogle } from '../lib/firebase';
import { useLanguage } from '../contexts/LanguageContext';
import AuthShowcase from './AuthShowcase';
import AuthInformation from './AuthInformation';
import AuthFloatingCards from './AuthFloatingCards';

const Auth = ({ isSignedIn = false }: { isSignedIn?: boolean }) => {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoNeedsPlay, setVideoNeedsPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => setVideoNeedsPlay(true));
  }, [reduceMotion]);
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
    getStarted: 'ចាប់ផ្តើមជាមួយ AI',
    createAccount: 'បង្កើតគណនីតាម Google',
    newHere: 'ថ្មីនៅ Aime?',
    benefits: ['ឧបករណ៍ក្នុងកន្លែងតែមួយ', 'ដំណើរការដោយ AI', 'សម្រាប់អាជីវកម្ម', 'ការចូលប្រើមានសុវត្ថិភាព'],
  } : {
    eyebrow: 'AI CREATIVE MARKETING PLATFORM',
    headline: 'Turn a simple idea into',
    headlineAccent: 'powerful content.',
    description: 'Create visuals and videos, schedule approved posts, and understand engagement in one AI marketing workspace.',
    welcome: 'Welcome to Aime',
    signInDescription: 'Sign in to start creating for your business.',
    secure: 'Secure sign-in with Google',
    signInLabel: 'YOUR CREATIVE SPACE',
    journey: 'Bring your idea. Leave with content ready to share.',
    getStarted: 'Get started with AI',
    createAccount: 'Create an account with Google',
    newHere: 'New to Aime?',
    benefits: ['All-in-one tools', 'Powered by AI', 'For business & creators', 'Secure sign-in'],
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

  const handlePrimaryAction = () => {
    if (isSignedIn) {
      window.location.assign('/app');
      return;
    }
    void handleGoogleLogin();
  };

  return (
    <main className={`min-h-screen bg-[#11152e] text-white ${isKhmer ? 'font-khmer' : ''}`}>
      <div className="relative isolate min-h-screen overflow-hidden">
        {reduceMotion ? <img
          src="/auth-keyboard-poster.webp"
          alt=""
          className="pointer-events-none absolute inset-x-0 top-0 h-[100svh] w-full object-cover object-center [mask-image:linear-gradient(to_bottom,black_0%,black_85%,transparent_100%)] lg:inset-0 lg:h-full lg:[mask-image:none]"
        /> : <video
          ref={videoRef}
          src="/auth-original-face-loop.mp4"
          poster="/auth-keyboard-poster.webp"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onPlaying={() => setVideoNeedsPlay(false)}
          onPause={() => setVideoNeedsPlay(true)}
          onError={() => setVideoNeedsPlay(true)}
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute inset-x-0 top-0 h-[100svh] w-full object-cover object-center [mask-image:linear-gradient(to_bottom,black_0%,black_85%,transparent_100%)] lg:inset-0 lg:h-full lg:[mask-image:none]"
        />}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#10122c]/72 via-[#15142f]/10 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#11142f]/35 via-transparent to-[#11142f]/10" />
      <AuthFloatingCards />

      <div className="relative mx-auto flex min-h-screen max-w-[1700px] flex-col px-5 pb-5 pt-6 sm:px-9 lg:px-14">
        {videoNeedsPlay && <button
          type="button"
          onClick={() => void videoRef.current?.play().catch(() => setVideoNeedsPlay(true))}
          className="absolute right-5 top-24 z-20 inline-flex items-center gap-2 rounded-full border border-white/40 bg-[#17162c]/80 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-md hover:bg-[#17162c] sm:right-9 lg:right-14"
        >
          <Play size={16} fill="currentColor" aria-hidden="true" /> {isKhmer ? 'ចាក់វីដេអូ' : 'Play video'}
        </button>}
        <header className="flex min-h-14 items-center gap-5 pr-24 sm:pr-32">
          <a href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300" aria-label="Aime Angkorgate home">
            <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-full shadow-[0_8px_26px_rgba(245,158,11,0.25)]" />
            <span className="font-display text-lg font-bold tracking-tight text-white max-[380px]:hidden sm:text-xl">aime<span className="text-[#ff933c]">.</span>angkorgate</span>
          </a>
        </header>

        <div className={`grid flex-1 items-center gap-8 py-9 lg:gap-10 xl:gap-16 ${isSignedIn ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(300px,350px)]'}`}>
          <section className="min-w-0 max-w-[760px]">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-300/60 bg-[#38243c]/65 px-4 py-2 text-[11px] font-bold tracking-[0.08em] text-orange-100 shadow-[0_0_28px_rgba(251,146,60,0.22)] backdrop-blur-sm sm:text-xs">
              <Sparkles size={16} aria-hidden="true" className="text-orange-300" /> {copy.eyebrow}
            </p>
            <h1 className={`max-w-[760px] text-[clamp(2.35rem,4vw,4.25rem)] font-extrabold leading-[1.08] tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.55)] ${isKhmer ? 'font-khmer leading-[1.28]' : 'font-display'}`}>
              {copy.headline}<span className="block bg-gradient-to-r from-[#ffc478] via-[#ff8846] to-[#ffb353] bg-clip-text text-transparent">{copy.headlineAccent}</span>
            </h1>
            <p className="mt-5 max-w-[570px] text-base leading-7 text-white/90 drop-shadow-[0_2px_9px_rgba(0,0,0,0.7)] sm:text-lg sm:leading-8">{copy.description}</p>
            <div className="mt-7 hidden lg:block"><AuthShowcase /></div>
            <motion.button
              whileHover={reduceMotion ? undefined : { y: -3 }}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              type="button"
              disabled={loading}
              onClick={handlePrimaryAction}
              className="mt-7 inline-flex min-h-13 items-center justify-center gap-3 rounded-full border border-orange-200/70 bg-gradient-to-r from-[#ffad23] to-[#f76807] px-7 py-3 text-sm font-bold text-white shadow-[0_10px_28px_rgba(242,98,5,0.45)] transition-[filter,box-shadow] hover:brightness-110 hover:shadow-[0_14px_32px_rgba(242,98,5,0.6)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"
            >
              <Sparkles size={19} aria-hidden="true" /> {isSignedIn ? (isKhmer ? 'បើក App' : 'Open App') : copy.getStarted} <ArrowRight size={18} aria-hidden="true" />
            </motion.button>
            <a href="#features" className="ml-4 inline-flex min-h-12 items-center text-sm font-semibold text-orange-100 underline-offset-4 hover:underline">
              {isKhmer ? 'ស្វែងយល់អំពីមុខងារ' : 'Explore the features'} <ArrowRight size={16} aria-hidden="true" className="ml-1.5" />
            </a>
          </section>

          {!isSignedIn && <section aria-label={copy.welcome} className="mt-36 w-full max-w-[350px] justify-self-center lg:mt-0 lg:self-end lg:justify-self-end lg:pb-7">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, boxShadow: ['0 22px 55px rgba(5,8,30,0.42)', '0 28px 70px rgba(237,107,17,0.24)', '0 22px 55px rgba(5,8,30,0.42)'] }}
              transition={reduceMotion ? undefined : { opacity: { duration: 0.5 }, boxShadow: { duration: 7, ease: 'easeInOut', repeat: Infinity } }}
              className="rounded-[1.75rem] border border-white/25 bg-[#17162c]/70 px-5 py-5 text-white shadow-[0_22px_55px_rgba(5,8,30,0.42)] backdrop-blur-md sm:px-6 sm:py-6"
            >
              <div className="flex items-center gap-3">
                <img src="/favicon.svg" alt="" className="h-10 w-10 shrink-0 rounded-full" />
                <div>
                  <h2 className={`text-xl font-bold leading-tight text-white ${isKhmer ? 'font-khmer' : 'font-display'}`}>{copy.welcome}</h2>
                  <p className="mt-0.5 text-xs leading-5 text-white/75">{isSignedIn ? (isKhmer ? 'អ្នកបានចូលគណនីរួចហើយ។ បើកផ្ទាំងការងារដើម្បីបន្ត។' : 'You are signed in. Open your workspace to continue.') : copy.signInDescription}</p>
                </div>
              </div>

              {error && <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-red-300/40 bg-red-950/70 p-3 text-sm text-red-100"><AlertCircle size={18} className="shrink-0" />{error}</div>}

              <motion.button
                whileHover={reduceMotion ? undefined : { scale: 1.02 }}
                whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                animate={reduceMotion ? undefined : { boxShadow: ['0 10px 25px rgba(238,103,6,0.35)', '0 15px 35px rgba(238,103,6,0.58)', '0 10px 25px rgba(238,103,6,0.35)'] }}
                transition={reduceMotion ? undefined : { duration: 5.5, ease: 'easeInOut', repeat: Infinity }}
                type="button"
                disabled={loading}
                onClick={handlePrimaryAction}
                className="mt-5 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full border border-orange-300 bg-gradient-to-r from-[#ffaf25] via-[#fc8510] to-[#ee6507] px-4 py-2.5 text-center text-sm font-bold text-white shadow-[0_10px_25px_rgba(238,103,6,0.4)] transition-[filter,box-shadow] hover:brightness-110 hover:shadow-[0_14px_28px_rgba(238,103,6,0.55)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {!isSignedIn && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm"><svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg></span>}
                {isSignedIn ? (isKhmer ? 'បើក App' : 'Open App') : t('continueWithGoogle')}
              </motion.button>
              {!isSignedIn && <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-white/75"><LockKeyhole size={13} aria-hidden="true" />{copy.secure}</p>}

              {!isSignedIn && <p className="mt-4 text-center text-xs text-white/70">{copy.newHere}{' '}<button type="button" disabled={loading} onClick={handleGoogleLogin} className="font-semibold text-orange-200 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50">{copy.createAccount}</button></p>}

              {!isSignedIn && <p className="mt-4 border-t border-white/15 pt-3 text-center text-[11px] leading-4 text-white/75">
                {t('termsAndPrivacyPrefix')}{' '}
                <a href="/terms-of-service/" className="font-semibold text-orange-200 underline-offset-4 hover:underline">{t('termsOfService')}</a> {t('and')}{' '}
                <a href="/privacy-policy/" className="font-semibold text-orange-200 underline-offset-4 hover:underline">{t('privacyPolicy')}</a>.
              </p>}
            </motion.div>
          </section>}
        </div>

        <div className="pb-7 lg:hidden"><AuthShowcase /></div>
        <footer className="grid grid-cols-2 gap-3 rounded-2xl border border-white/15 bg-[#17172d]/45 px-4 py-4 text-[11px] font-semibold text-white/90 backdrop-blur-md sm:text-xs lg:grid-cols-4 lg:gap-0 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:bg-[#17172d]/25 lg:px-0">
          {copy.benefits.map((benefit, index) => {
            const icons = [ShieldCheck, Zap, Users, LockKeyhole];
            const Icon = icons[index];
            return <div key={benefit} className="flex items-center justify-center gap-2 text-center lg:border-r lg:border-white/20 lg:last:border-0"><Icon size={19} className="shrink-0 text-orange-200" aria-hidden="true" />{benefit}</div>;
          })}
        </footer>
      </div>
      </div>
      <AuthInformation />
    </main>
  );
};

export default Auth;
