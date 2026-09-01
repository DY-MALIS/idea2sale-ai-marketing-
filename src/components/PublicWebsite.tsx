import { ArrowRight, Bot, CalendarClock, ChartNoAxesCombined, CheckCircle2, Image, ShieldCheck, Sparkles } from 'lucide-react';

const features = [
  { icon: Bot, title: 'AI Marketing Assistant', detail: 'Plan campaigns, draft copy, and turn business ideas into practical content.' },
  { icon: Image, title: 'Image and Video Creation', detail: 'Create brand-ready visual concepts and short-form video assets with AI assistance.' },
  { icon: CalendarClock, title: 'Content Scheduling', detail: 'Prepare and schedule approved content for connected social channels.' },
  { icon: ChartNoAxesCombined, title: 'Analytics and CRM', detail: 'Review publishing activity, engagement, comments, and customer intent in one workspace.' },
];

const PublicWebsite = () => (
  <main className="min-h-screen bg-mesh px-6 py-10 text-slate-700 dark:text-slate-200">
    <div className="mx-auto max-w-6xl">
      <nav className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/60 bg-white/85 px-6 py-4 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/85">
        <a href="/" className="flex items-center gap-3">
          <img src="/favicon.svg" alt="aime.angkorgate logo" className="h-11 w-11 rounded-xl" />
          <span className="text-xl font-black text-brand-700 dark:text-brand-400">aime.angkorgate</span>
        </a>
        <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
          <a href="/privacy-policy" className="hover:text-brand-700 dark:hover:text-brand-400">Privacy Policy</a>
          <a href="/terms-of-service" className="hover:text-brand-700 dark:hover:text-brand-400">Terms of Service</a>
          <a href="#features" className="hover:text-brand-700 dark:hover:text-brand-400">Features</a>
          <a href="#how-it-works" className="hover:text-brand-700 dark:hover:text-brand-400">How it works</a>
          <a href="/app" className="rounded-full bg-brand-600 px-5 py-2.5 text-white shadow-sm hover:bg-brand-700">Open App</a>
        </div>
      </nav>

      <section className="grid items-center gap-10 py-20 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-brand-600 dark:text-brand-400"><Sparkles size={18} /> AI marketing workspace</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-black leading-tight text-slate-950 md:text-7xl dark:text-white">Create, schedule, and understand your content in one place.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">aime.angkorgate helps businesses develop marketing ideas, create visual content, organize publishing, and understand audience engagement through a secure AI-assisted workspace.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/app" className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 font-bold text-white shadow-lg hover:bg-brand-700">Use aime.angkorgate <ArrowRight size={18} /></a>
            <a href="mailto:dymalis88@gmail.com" className="rounded-full border border-brand-300 bg-white/70 px-6 py-3 font-bold text-brand-700 hover:bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-brand-400">Contact us</a>
          </div>
        </div>
        <div className="rounded-[2rem] border border-brand-200/70 bg-white/85 p-8 shadow-2xl dark:border-slate-700 dark:bg-slate-900/85">
          <ShieldCheck className="h-12 w-12 text-brand-600 dark:text-brand-400" />
          <h2 className="mt-6 text-2xl font-black text-slate-950 dark:text-white">Built for responsible publishing</h2>
          <p className="mt-4 leading-7 text-slate-600 dark:text-slate-300">Users review and approve generated content before publishing. Connected-platform access is permission-based and can be revoked through the relevant platform settings.</p>
          <div className="mt-6 border-t border-slate-200 pt-6 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <p><strong className="text-slate-700 dark:text-slate-200">Operated by:</strong> aime.angkorgate</p>
            <p><strong className="text-slate-700 dark:text-slate-200">Support:</strong> dymalis88@gmail.com</p>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-8 pb-16">
        <h2 className="text-3xl font-black text-slate-950 dark:text-white">What the service provides</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-3xl border border-white/70 bg-white/85 p-7 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
              <feature.icon className="h-7 w-7 text-brand-600 dark:text-brand-400" />
              <h3 className="mt-5 text-xl font-black text-slate-950 dark:text-white">{feature.title}</h3>
              <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{feature.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-y border-slate-300/70 py-16 dark:border-slate-700">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-brand-600 dark:text-brand-400">How it works</p>
            <h2 className="mt-4 text-3xl font-black text-slate-950 dark:text-white">You stay in control from idea to publication.</h2>
            <p className="mt-4 leading-7 text-slate-600 dark:text-slate-300">The service helps prepare content and carries out publishing actions only after you choose the content, destination, and permissions.</p>
          </div>
          <div className="grid gap-4">
            {[
              ['1', 'Create or upload', 'Describe a campaign, draft copy, or provide an image or video you own.'],
              ['2', 'Review and approve', 'Check AI-assisted output, make changes, and select a connected channel.'],
              ['3', 'Publish or schedule', 'Authorize the requested action and review activity from your workspace.'],
            ].map(([step, title, detail]) => (
              <article key={step} className="flex gap-5 rounded-3xl bg-white/85 p-6 shadow-sm dark:bg-slate-900/80">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-black text-brand-700 dark:bg-slate-800 dark:text-brand-400">{step}</span>
                <div><h3 className="font-black text-slate-950 dark:text-white">{title}</h3><p className="mt-2 leading-7 text-slate-600 dark:text-slate-300">{detail}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-8 py-16 lg:grid-cols-2">
        <article className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
          <h2 className="text-2xl font-black text-slate-950 dark:text-white">Connected platforms and your data</h2>
          <p className="mt-4 leading-7 text-slate-600 dark:text-slate-300">Connections such as TikTok are optional and permission-based. We request only the access needed for features you choose. You can disconnect a platform and request deletion of associated data at any time.</p>
          <a href="/privacy-policy" className="mt-6 inline-flex items-center gap-2 font-bold text-brand-700 dark:text-brand-400">Read our Privacy Policy <ArrowRight size={17} /></a>
        </article>
        <article className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
          <h2 className="text-2xl font-black text-slate-950 dark:text-white">Responsible use commitments</h2>
          <div className="mt-5 space-y-3">
            {['Human review before publishing', 'Revocable platform permissions', 'No sale of connected-platform data', 'Support for access and deletion requests'].map((item) => (
              <p key={item} className="flex items-center gap-3 text-slate-600 dark:text-slate-300"><CheckCircle2 size={19} className="shrink-0 text-brand-600 dark:text-brand-400" />{item}</p>
            ))}
          </div>
        </article>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-300/70 py-8 text-sm dark:border-slate-700">
        <p>© 2026 aime.angkorgate. All rights reserved.</p>
        <div className="flex gap-5 font-semibold">
          <a href="/privacy-policy" className="hover:text-brand-700 dark:hover:text-brand-400">Privacy Policy</a>
          <a href="/terms-of-service" className="hover:text-brand-700 dark:hover:text-brand-400">Terms of Service</a>
          <a href="mailto:dymalis88@gmail.com" className="hover:text-brand-700 dark:hover:text-brand-400">Contact</a>
        </div>
      </footer>
    </div>
  </main>
);

export default PublicWebsite;
