import { motion, useReducedMotion } from 'motion/react';
import { CalendarDays, Image as ImageIcon, PenLine, Video } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const AuthShowcase = () => {
  const { language } = useLanguage();
  const reducedMotion = useReducedMotion();
  const khmer = language === 'km';
  const tiles = [
    { Icon: ImageIcon, label: khmer ? 'បង្កើតរូបភាព' : 'Create images', color: 'from-violet-500/55 to-fuchsia-500/20', icon: 'text-violet-100', delay: 0 },
    { Icon: Video, label: khmer ? 'បង្កើតវីដេអូ' : 'Make videos', color: 'from-pink-500/55 to-rose-500/20', icon: 'text-pink-100', delay: 0.3 },
    { Icon: PenLine, label: khmer ? 'សរសេរមាតិកា' : 'Write content', color: 'from-sky-500/55 to-blue-500/20', icon: 'text-sky-100', delay: 0.6 },
    { Icon: CalendarDays, label: khmer ? 'រៀបចំផែនការ' : 'Plan & schedule', color: 'from-amber-500/55 to-orange-500/20', icon: 'text-amber-100', delay: 0.9 },
  ];

  return (
    <ul aria-label={khmer ? 'ឧបករណ៍បង្កើតមាតិកា' : 'Creative tools'} className="grid max-w-[510px] grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
      {tiles.map(({ Icon, label, color, icon, delay }) => (
        <motion.li
          key={label}
          animate={reducedMotion ? undefined : { y: [0, -7, 0] }}
          transition={{ duration: 3.4, delay, ease: 'easeInOut', repeat: Infinity }}
          className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-white/25 bg-gradient-to-br ${color} px-2 py-3 text-center text-white shadow-[0_16px_34px_-14px_rgba(5,8,26,0.8)] backdrop-blur-md sm:min-h-28`}
        >
          <Icon size={27} strokeWidth={1.8} className={icon} aria-hidden="true" />
          <span className="text-[11px] font-semibold leading-tight sm:text-xs">{label}</span>
        </motion.li>
      ))}
    </ul>
  );
};

export default AuthShowcase;
