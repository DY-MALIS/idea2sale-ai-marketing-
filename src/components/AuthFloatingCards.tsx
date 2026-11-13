import { motion, useReducedMotion } from 'motion/react';
import { CalendarCheck2, ImageIcon, Play, TrendingUp } from 'lucide-react';

const AuthFloatingCards = () => {
  const reduceMotion = useReducedMotion();
  const float = (offset: number, duration: number) => reduceMotion ? undefined : {
    animate: { y: [0, offset, 0] },
    transition: { duration, repeat: Infinity, ease: 'easeInOut' as const },
  };

  return (
    <div aria-hidden="true" className="pointer-events-none absolute right-[4%] top-[25%] z-[1] hidden h-[320px] w-[365px] origin-top-right scale-75 md:block lg:right-[7%] lg:top-[27%] lg:scale-100 xl:right-[10%] xl:top-[29%]">
      <motion.div
        {...float(-7, 7)}
        className="absolute left-0 top-0 w-[260px] rotate-[5deg] rounded-[25px] border border-[#c68dff]/90 bg-gradient-to-br from-[#9c6bff]/80 to-[#34245d]/85 p-2.5 shadow-[0_0_26px_rgba(170,91,255,0.75)] backdrop-blur-md"
      >
        <div className="relative overflow-hidden rounded-[17px] border border-white/30 bg-[#211a42]">
          <img src="/auth-temple-thumb.webp" alt="" className="aspect-video w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center"><Play size={48} fill="white" className="text-white drop-shadow-lg" /></span>
          <div className="flex h-5 items-center gap-1.5 bg-[#231d38]/95 px-2 text-white"><Play size={10} fill="white" /><span className="h-1 w-24 rounded-full bg-white/75" /><span className="h-2 w-2 rounded-full bg-orange-500" /></div>
        </div>
      </motion.div>
      <motion.div
        {...float(6, 6)}
        className="absolute right-0 top-12 flex h-[103px] w-[113px] rotate-[8deg] items-center justify-center rounded-[23px] border border-[#cda8ff]/80 bg-gradient-to-br from-[#b47eff]/70 to-[#48316d]/75 text-[#f4d8ff] shadow-[0_0_23px_rgba(181,105,255,0.75)] backdrop-blur-md"
      ><ImageIcon size={55} strokeWidth={1.8} /></motion.div>
      <motion.div
        {...float(-5, 6.5)}
        className="absolute left-[105px] top-[180px] flex h-[108px] w-[118px] -rotate-[8deg] items-center justify-center rounded-[23px] border border-[#d7a5ff]/80 bg-gradient-to-br from-[#ffbd77]/85 to-[#7852aa]/75 text-white shadow-[0_0_24px_rgba(185,105,255,0.7)] backdrop-blur-md"
      ><span className="relative mt-3 h-14 w-12 rounded-lg border border-amber-200/70 bg-gradient-to-b from-[#824114] via-[#d77913] to-[#5b290e] shadow-[0_5px_12px_rgba(44,15,7,0.5)]"><span className="absolute -top-3 left-0 h-3 w-full rounded-t-lg bg-[#57351e]" /><span className="absolute -left-7 bottom-0 text-4xl text-white drop-shadow-lg">✿</span></span></motion.div>
      <motion.div
        {...float(6, 7.5)}
        className="absolute right-0 top-[174px] flex h-[100px] w-[113px] rotate-[5deg] items-center justify-center rounded-[23px] border border-[#caa0ff]/80 bg-gradient-to-br from-[#7154bb]/75 to-[#3b286b]/80 text-[#ffcf67] shadow-[0_0_24px_rgba(193,103,255,0.7)] backdrop-blur-md"
      ><TrendingUp size={58} strokeWidth={2.2} /></motion.div>
      <div className="absolute bottom-0 right-9 flex h-[58px] w-[77px] -rotate-[7deg] items-center justify-center rounded-[16px] border border-[#caa0ff]/75 bg-gradient-to-br from-[#8051b4]/75 to-[#352556]/85 text-[#ffce73] shadow-[0_0_18px_rgba(184,90,255,0.65)] backdrop-blur-md"><CalendarCheck2 size={38} /></div>
    </div>
  );
};

export default AuthFloatingCards;

