import React, { useState } from 'react';
import Markdown from 'react-markdown';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Facebook,
  Heart,
  Loader2,
  Radar,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  Video,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { CreativeAutomationRequest, FacebookScanResult, FacebookVideoPlanItem } from '../types';

interface FacebookScannerProps {
  onCreativeAutomation: (request: CreativeAutomationRequest) => void;
}

const countryOptions = [
  { code: 'KH', label: 'Cambodia' },
  { code: 'TH', label: 'Thailand' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'US', label: 'United States' },
];

const FacebookScanner: React.FC<FacebookScannerProps> = ({ onCreativeAutomation }) => {
  const { language } = useLanguage();
  const isKm = language === 'km';
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('KH');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FacebookScanResult | null>(null);
  const [copied, setCopied] = useState(false);

  const text = isKm ? {
    eyebrow: 'Facebook Audience Intelligence',
    title: 'ស្គេនអតិថិជន និងគូប្រជែង',
    subtitle: 'វិភាគតម្រូវការ ចំណង់ចំណូលចិត្ត គូប្រជែង និងបង្កើតកាលវិភាគវីដេអូដោយ AI។',
    sourceTitle: 'ទិន្នន័យមានសុវត្ថិភាព និងគោរពឯកជនភាព',
    sourceBody: 'ប្រើតែ Facebook Ad Library សាធារណៈ និងទិន្នន័យដែលអ្នកមានសិទ្ធិចូលប្រើ។ វាមិនចូលមើល profile ឯកជន សារ ឬពាក្យសម្ងាត់អតិថិជនទេ។',
    query: 'ផលិតផល ទីផ្សារ ឬឈ្មោះ Page គូប្រជែង',
    placeholder: 'ឧ. ហាងសម្លៀកបំពាក់នារី, skincare Cambodia, ឈ្មោះ Page...',
    market: 'ទីផ្សារគោលដៅ',
    duration: 'ផែនការវីដេអូ',
    days: 'ថ្ងៃ',
    scan: 'ចាប់ផ្តើមស្គេន និងធ្វើផែនការ',
    scanning: 'AI កំពុងវិភាគទិន្នន័យ...',
    bought: 'អ្វីដែលពួកគេទិញ និងត្រូវការ',
    likes: 'អ្វីដែលពួកគេចូលចិត្ត',
    content: 'Content ដែលពួកគេចង់មើល',
    personas: 'ក្រុមអតិថិជនគោលដៅ',
    competitors: 'ការវិភាគគូប្រជែង',
    angle: 'ទិសដៅសំខាន់',
    offer: 'យុទ្ធសាស្ត្រផ្តល់ជូន',
    weakness: 'ចំណុចខ្សោយ',
    counter: 'ឱកាសរបស់យើង',
    plan: 'កាលវិភាគបង្កើតវីដេអូ',
    create: 'បង្កើតវីដេអូនេះ',
    report: 'របាយការណ៍យុទ្ធសាស្ត្រ',
    copy: 'ចម្លងរបាយការណ៍',
    copied: 'បានចម្លង',
    live: 'Meta Ad Library បានភ្ជាប់',
    estimated: 'AI market estimate',
    ads: 'ផ្សាយពាណិជ្ជកម្មសាធារណៈត្រូវបានរកឃើញ',
  } : {
    eyebrow: 'Facebook Audience Intelligence',
    title: 'Customer & competitor scanner',
    subtitle: 'Understand demand, preferences and competitors, then turn the findings into an AI video calendar.',
    sourceTitle: 'Privacy-safe research',
    sourceBody: 'Uses public Facebook Ad Library data and sources you are authorized to access. It never reads private profiles, messages, or customer passwords.',
    query: 'Product, market, or competitor Page',
    placeholder: 'e.g. women’s fashion, skincare Cambodia, competitor Page name…',
    market: 'Target market',
    duration: 'Video plan',
    days: 'days',
    scan: 'Scan audience & build plan',
    scanning: 'AI is analyzing the market…',
    bought: 'What they buy and need',
    likes: 'What they appreciate',
    content: 'Content they want to see',
    personas: 'Target customer groups',
    competitors: 'Competitor intelligence',
    angle: 'Leading angle',
    offer: 'Offer strategy',
    weakness: 'Weakness',
    counter: 'Our opportunity',
    plan: 'Video production calendar',
    create: 'Create this video',
    report: 'Strategy report',
    copy: 'Copy report',
    copied: 'Copied',
    live: 'Meta Ad Library connected',
    estimated: 'AI market estimate',
    ads: 'public ads found',
  };

  const scan = async () => {
    const cleanQuery = query.trim();
    if (!cleanQuery || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'facebookIntelligenceScan',
          query: cleanQuery,
          countries: [country],
          days,
          language,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Facebook research could not be completed.');
      setResult(data as FacebookScanResult);
    } catch (scanError: any) {
      setError(scanError?.message || (isKm ? 'មិនអាចវិភាគបានទេ។ សូមព្យាយាមម្តងទៀត។' : 'The scan failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const createVideo = (item: FacebookVideoPlanItem) => {
    onCreativeAutomation({
      id: `facebook-scan-${Date.now()}-${item.date}`,
      kind: 'video',
      prompt: `${item.prompt}\n\nPerformance direction: ${item.performanceStyle}\nHook: ${item.hook}`,
      platform: 'Facebook',
      aspectRatio: '9:16',
      language: 'km',
      voiceOverText: item.voiceOverText,
      duration: 8,
    });
  };

  const copyReport = async () => {
    if (!result?.summaryReport) return;
    await navigator.clipboard.writeText(result.summaryReport);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const insightCards = result ? [
    { title: text.bought, icon: ShoppingBag, items: result.customerInsights.whatTheyBought, iconClass: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300' },
    { title: text.likes, icon: Heart, items: result.customerInsights.whatTheyLike, iconClass: 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300' },
    { title: text.content, icon: Video, items: result.customerInsights.contentDesires, iconClass: 'bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300' },
  ] : [];

  return (
    <div className="space-y-8 pb-12">
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#1877F2] via-blue-600 to-indigo-700 p-8 text-white shadow-2xl shadow-blue-500/20">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative grid gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
              <Facebook size={15} /> {text.eyebrow}
            </div>
            <h2 className="max-w-3xl text-3xl font-black tracking-tight md:text-5xl">{text.title}</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-100 md:text-base">{text.subtitle}</p>
          </div>
          <div className="rounded-3xl border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={22} />
              <div>
                <p className="font-bold">{text.sourceTitle}</p>
                <p className="mt-1 text-xs leading-6 text-blue-100">{text.sourceBody}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="glass rounded-[2rem] p-6 md:p-8">
        <div className="grid gap-5 lg:grid-cols-[1fr_190px_150px]">
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.query}</span>
            <div className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-white/80 px-4 dark:bg-slate-900/70">
              <Search className="shrink-0 text-brand-500" size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void scan()}
                placeholder={text.placeholder}
                className="h-14 w-full bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
              />
            </div>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.market}</span>
            <select value={country} onChange={(event) => setCountry(event.target.value)} className="h-14 w-full rounded-2xl border border-brand-200 bg-white/80 px-4 text-sm font-bold text-slate-700 outline-none dark:bg-slate-900/70 dark:text-white">
              {countryOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-700 dark:text-brand-300">{text.duration}</span>
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="h-14 w-full rounded-2xl border border-brand-200 bg-white/80 px-4 text-sm font-bold text-slate-700 outline-none dark:bg-slate-900/70 dark:text-white">
              {[3, 7, 10, 14].map((value) => <option key={value} value={value}>{value} {text.days}</option>)}
            </select>
          </label>
        </div>
        <button onClick={() => void scan()} disabled={loading || !query.trim()} className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#1877F2] to-indigo-600 py-4 font-bold text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" size={20} /> : <Radar size={20} />}
          {loading ? text.scanning : text.scan}
        </button>
        {error && <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><AlertCircle className="shrink-0" size={18} />{error}</div>}
      </section>

      {result && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${result.metaApiAvailable ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
              {result.metaApiAvailable ? <Check size={15} /> : <Sparkles size={15} />}
              {result.metaApiAvailable ? text.live : text.estimated}
            </span>
            <span className="rounded-full bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{result.adsFound || 0} {text.ads}</span>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            {insightCards.map(({ title, icon: Icon, items, iconClass }) => (
              <article key={title} className="glass rounded-[2rem] p-6">
                <div className="mb-5 flex items-center gap-3">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconClass}`}><Icon size={21} /></span>
                  <h3 className="font-black text-slate-800 dark:text-white">{title}</h3>
                </div>
                <ul className="space-y-3">
                  {items.map((item, index) => <li key={index} className="flex gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><Check className="mt-1 shrink-0 text-emerald-500" size={15} /><span>{item}</span></li>)}
                </ul>
              </article>
            ))}
          </div>

          {!!result.customerInsights.targetPersonas.length && (
            <section>
              <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><Users className="text-blue-500" />{text.personas}</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {result.customerInsights.targetPersonas.map((persona, index) => (
                  <article key={`${persona.name}-${index}`} className="glass rounded-3xl p-5">
                    <p className="font-black text-brand-700 dark:text-brand-300">{persona.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{persona.description}</p>
                    <div className="mt-4 flex gap-2 rounded-2xl bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200"><Target className="shrink-0" size={16} />{persona.buyingTriggers}</div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {!!result.competitors.length && (
            <section>
              <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><BarChart3 className="text-indigo-500" />{text.competitors}</h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {result.competitors.map((competitor, index) => (
                  <article key={`${competitor.pageName}-${index}`} className="glass rounded-3xl p-6">
                    <div className="mb-4 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-black text-white">{index + 1}</span><h4 className="text-lg font-black text-slate-800 dark:text-white">{competitor.pageName}</h4></div>
                    <dl className="grid gap-3 text-sm">
                      <div><dt className="font-bold text-slate-400">{text.angle}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.topAngle}</dd></div>
                      <div><dt className="font-bold text-slate-400">{text.offer}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.offerStrategy}</dd></div>
                      <div><dt className="font-bold text-rose-500">{text.weakness}</dt><dd className="mt-1 text-slate-700 dark:text-slate-200">{competitor.weakness}</dd></div>
                      <div className="rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-950/30"><dt className="font-bold text-emerald-700 dark:text-emerald-300">{text.counter}</dt><dd className="mt-1 text-emerald-800 dark:text-emerald-100">{competitor.counterStrategy}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          )}

          {!!result.videoPlan.length && (
            <section>
              <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white"><CalendarDays className="text-violet-500" />{text.plan}</h3>
              <div className="space-y-4">
                {result.videoPlan.map((item, index) => (
                  <article key={`${item.date}-${index}`} className="glass grid gap-5 rounded-3xl p-5 lg:grid-cols-[150px_1fr_auto] lg:items-center">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-blue-500">{item.day}</p>
                      <p className="mt-1 font-black text-slate-800 dark:text-white">{item.date}</p>
                      <p className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-500"><Clock3 size={14} />{item.suggestedPostTime}</p>
                    </div>
                    <div>
                      <h4 className="font-black text-slate-800 dark:text-white">{item.topic}</h4>
                      <p className="mt-2 text-sm font-bold text-rose-500">“{item.hook}”</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.targetDesire}</p>
                      <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-300">🎙️ {item.voiceOverText}</p>
                    </div>
                    <button onClick={() => createVideo(item)} className="flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-violet-700"><Video size={17} />{text.create}</button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {result.summaryReport && (
            <section className="glass rounded-[2rem] p-6 md:p-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xl font-black text-slate-800 dark:text-white">{text.report}</h3>
                <button onClick={() => void copyReport()} className="flex items-center gap-2 rounded-xl border border-brand-200 bg-white/70 px-4 py-2 text-xs font-bold text-brand-700 dark:bg-slate-900 dark:text-brand-300">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? text.copied : text.copy}</button>
              </div>
              <div className="prose prose-brand max-w-none text-slate-700 dark:text-slate-200"><Markdown>{result.summaryReport}</Markdown></div>
            </section>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default FacebookScanner;
