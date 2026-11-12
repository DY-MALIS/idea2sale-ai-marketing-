import { motion, useReducedMotion } from 'motion/react';
import { CalendarDays, Check, Image as ImageIcon, PenLine, Play, Sparkles, Video } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const floating = (enabled: boolean, duration: number, delay = 0) => enabled
  ? { animate: { y: [0, -7, 0] }, transition: { duration, delay, ease: 'easeInOut' as const, repeat: Infinity } }
  : {};

// A small, animated tour of the actual creative tools. It is decorative:
// the nearby heading and description carry the accessible product message.
const AuthShowcase = () => {
  const { language } = useLanguage();
  const animate = !useReducedMotion();
  const km = language === 'km';
  const labels = km ? {
    studio: 'ស្ទូឌីយោ Aime',
    draft: 'អត្ថបទដោយ AI',
    draftLine: 'គំនិតថ្មី សម្រាប់ការផ្សព្វផ្សាយ...',
    image: 'រូបភាពផ្សព្វផ្សាយ',
    video: 'វីដេអូខ្លី',
    schedule: 'ផែនការបង្ហោះ',
    ready: 'ត្រៀមរួចរាល់',
  } : {
    studio: 'Aime Studio',
    draft: 'AI copy',
    draftLine: 'A fresh idea for your next post...',
    image: 'Campaign image',
    video: 'Short video',
    schedule: 'Content plan',
    ready: 'Ready to create',
  };

  return (
    <div aria-hidden="true" className="relative isolate mt-7 h-[190px] overflow-hidden rounded-[2rem] border border-white/15 bg-[#111a39]/90 p-4 shadow-[0_32px_90px_-30px_rgba(5,8,30,0.9)] sm:h-[370px] sm:p-6 md:mt-auto lg:h-[380px]">
      <div className="pointer-events-none absolute -left-16 top-24 h-48 w-48 rounded-full bg-[#ff8b3d]/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-10 bottom-0 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
      <div className="relative flex items-center justify-between border-b border-white/10 pb-3 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-amber-600 shadow-[0_0_24px_rgba(251,146,60,0.55)]"><Sparkles size={17} /></span>
          <span className="font-display text-sm font-bold tracking-wide">{labels.studio}</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 motion-safe:animate-pulse" />
          {labels.ready}
        </span>
      </div>

      <div className="relative mt-4 grid grid-cols-2 gap-3 sm:gap-4">
        <motion.div {...floating(animate, 4.2)} className="flex h-[111px] flex-col rounded-2xl border border-violet-200/25 bg-gradient-to-br from-[#363166] to-[#232b59] p-3 shadow-[0_18px_35px_-20px_rgba(133,105,255,0.9)] sm:h-[125px] sm:p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-white sm:text-sm">
            <PenLine size={16} className="text-violet-200" />{labels.draft}
          </div>
          <p className="mt-2 truncate text-[10px] text-violet-100/90 sm:text-xs">{labels.draftLine}</p>
          <div className="mt-auto space-y-1.5">
            <div className="h-1.5 w-4/5 rounded-full bg-white/65" />
            <motion.div
              animate={animate ? { width: ['38%', '68%', '38%'] } : undefined}
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
              className="h-1.5 rounded-full bg-orange-300"
              style={{ width: '68%' }}
            />
          </div>
        </motion.div>

        <motion.div {...floating(animate, 4.8, 0.4)} className="relative h-[111px] overflow-hidden rounded-2xl border border-orange-200/40 bg-gradient-to-br from-[#f8be7d] to-[#9a4b4d] shadow-[0_18px_35px_-20px_rgba(255,167,83,0.9)] sm:h-[125px]">
          <img src="/auth-hero.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-85" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#160f2a]/90 to-transparent" />
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 text-xs font-bold text-white sm:inset-x-4 sm:text-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500"><ImageIcon size={15} /></span>
            {labels.image}
          </div>
        </motion.div>

        <motion.div {...floating(animate, 4.5, 0.8)} className="relative hidden h-[111px] overflow-hidden rounded-2xl border border-sky-200/25 bg-gradient-to-br from-[#343e76] via-[#3b326e] to-[#a7466d] p-3 shadow-[0_18px_35px_-20px_rgba(107,137,255,0.8)] sm:block sm:h-[125px] sm:p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-white sm:text-sm"><Video size={16} className="text-sky-200" />{labels.video}</div>
          <div className="absolute inset-x-0 top-9 flex justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-white/20 text-white shadow-lg backdrop-blur-sm"><Play size={17} fill="currentColor" /></span>
          </div>
          <div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-white/30 sm:inset-x-4">
            <motion.div animate={animate ? { width: ['18%', '88%', '18%'] } : undefined} transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }} className="h-full rounded-full bg-orange-300" style={{ width: '55%' }} />
          </div>
        </motion.div>

        <motion.div {...floating(animate, 5, 0.2)} className="hidden h-[111px] rounded-2xl border border-cyan-200/20 bg-gradient-to-br from-[#1c4661] to-[#1b3659] p-3 shadow-[0_18px_35px_-20px_rgba(31,164,200,0.65)] sm:block sm:h-[125px] sm:p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-white sm:text-sm"><CalendarDays size={16} className="text-cyan-200" />{labels.schedule}</div>
          <div className="mt-3 grid grid-cols-5 gap-1.5 sm:mt-4">
            {[0, 1, 2, 3, 4].map((day) => (
              <span key={day} className={`flex h-7 items-center justify-center rounded-md border text-[10px] ${day === 2 ? 'border-orange-300/60 bg-orange-400 text-white' : 'border-white/10 bg-white/10 text-cyan-100'}`}>
                {day === 2 ? <Check size={14} /> : day + 12}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default AuthShowcase;
