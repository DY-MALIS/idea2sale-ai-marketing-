import { ArrowRight, Bot, CalendarClock, ChartNoAxesCombined, CheckCircle2, Image, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const AuthInformation = () => {
  const { language } = useLanguage();
  const khmer = language === 'km';
  const copy = khmer ? {
    featuresEyebrow: 'មុខងារ',
    featuresTitle: 'ឧបករណ៍ទីផ្សារនៅកន្លែងតែមួយ',
    features: [
      ['ជំនួយការ AI សម្រាប់ទីផ្សារ', 'រៀបចំយុទ្ធនាការ សរសេរអត្ថបទ និងបម្លែងគំនិតអាជីវកម្មទៅជាមាតិកាដែលអាចប្រើបាន។'],
      ['បង្កើតរូបភាព និងវីដេអូ', 'បង្កើតរូបភាព និងវីដេអូខ្លីសម្រាប់ម៉ាករបស់អ្នកដោយមានជំនួយពី AI។'],
      ['កំណត់ពេលបង្ហោះ', 'រៀបចំ និងកំណត់ពេលបង្ហោះមាតិកាដែលអ្នកបានពិនិត្យរួចទៅកាន់បណ្តាញដែលបានភ្ជាប់។'],
      ['ទិន្នន័យ និងអតិថិជន', 'មើលសកម្មភាពបង្ហោះ ការចូលរួម មតិយោបល់ និងតម្រូវការអតិថិជននៅកន្លែងតែមួយ។'],
    ],
    stepsEyebrow: 'របៀបប្រើ',
    stepsTitle: 'អ្នកគ្រប់គ្រងគ្រប់ជំហាន',
    stepsIntro: 'សេវាជួយរៀបចំមាតិកា ហើយបង្ហោះតែបន្ទាប់ពីអ្នកជ្រើសរើសមាតិកា គោលដៅ និងការអនុញ្ញាត។',
    steps: [
      ['បង្កើត ឬបញ្ចូល', 'ពណ៌នាយុទ្ធនាការ សរសេរអត្ថបទ ឬបញ្ចូលរូបភាព និងវីដេអូដែលអ្នកមានសិទ្ធិប្រើ។'],
      ['ពិនិត្យ និងអនុម័ត', 'ពិនិត្យលទ្ធផល AI កែតម្រូវ ហើយជ្រើសបណ្តាញដែលបានភ្ជាប់។'],
      ['បង្ហោះ ឬកំណត់ពេល', 'អនុញ្ញាតសកម្មភាពដែលអ្នកបានជ្រើស ហើយពិនិត្យស្ថានភាពក្នុងផ្ទាំងការងារ។'],
    ],
    responsibilityTitle: 'បង្ហោះដោយមានការគ្រប់គ្រង',
    responsibilityBody: 'អ្នកពិនិត្យ និងអនុម័តមាតិកាមុនបង្ហោះ។ ការភ្ជាប់បណ្តាញត្រូវការការអនុញ្ញាត ហើយអ្នកអាចដកសិទ្ធិនោះចេញតាមការកំណត់របស់បណ្តាញ។',
    dataTitle: 'បណ្តាញដែលបានភ្ជាប់ និងទិន្នន័យរបស់អ្នក',
    dataBody: 'ការភ្ជាប់ YouTube ឬ TikTok ជាជម្រើស។ យើងស្នើសិទ្ធិតាមមុខងារដែលអ្នកជ្រើស ហើយអ្នកអាចស្នើឱ្យលុបទិន្នន័យដែលពាក់ព័ន្ធ។',
    commitments: ['ពិនិត្យដោយមនុស្សមុនបង្ហោះ', 'អាចដកសិទ្ធិបណ្តាញចេញបាន', 'មិនលក់ទិន្នន័យពីបណ្តាញដែលបានភ្ជាប់', 'គាំទ្រសំណើមើល និងលុបទិន្នន័យ'],
    privacy: 'អានគោលការណ៍ឯកជនភាព',
    terms: 'លក្ខខណ្ឌប្រើប្រាស់',
    support: 'ជំនួយ',
    operatedBy: 'ដំណើរការដោយ',
  } : {
    featuresEyebrow: 'Features',
    featuresTitle: 'Your marketing tools in one workspace',
    features: [
      ['AI Marketing Assistant', 'Plan campaigns, draft copy, and turn business ideas into practical content.'],
      ['Image and Video Creation', 'Create brand-ready visual concepts and short-form video assets with AI assistance.'],
      ['Content Scheduling', 'Prepare and schedule approved content for connected social channels.'],
      ['Analytics and CRM', 'Review publishing activity, engagement, comments, and customer intent in one workspace.'],
    ],
    stepsEyebrow: 'How it works',
    stepsTitle: 'You stay in control from idea to publication',
    stepsIntro: 'The service helps prepare content and publishes only after you choose the content, destination, and permissions.',
    steps: [
      ['Create or upload', 'Describe a campaign, draft copy, or provide an image or video you own.'],
      ['Review and approve', 'Check AI-assisted output, make changes, and select a connected channel.'],
      ['Publish or schedule', 'Authorize the requested action and review activity from your workspace.'],
    ],
    responsibilityTitle: 'Built for responsible publishing',
    responsibilityBody: 'You review and approve generated content before publishing. Connected-platform access is permission-based and can be revoked in the relevant platform settings.',
    dataTitle: 'Connected platforms and your data',
    dataBody: 'Connections such as YouTube and TikTok are optional. We request access for the features you choose, and you can request deletion of associated data.',
    commitments: ['Human review before publishing', 'Revocable platform permissions', 'No sale of connected-platform data', 'Support for access and deletion requests'],
    privacy: 'Read our Privacy Policy',
    terms: 'Terms of Service',
    support: 'Support',
    operatedBy: 'Operated by',
  };
  const icons = [Bot, Image, CalendarClock, ChartNoAxesCombined];

  return (
    <div className="relative bg-gradient-to-b from-[#11152e] via-[#191630] to-[#11152e] px-5 text-white sm:px-9 lg:px-14">
      <div className="mx-auto max-w-[1500px]">
        <section id="features" aria-labelledby="auth-features-title" className="scroll-mt-8 py-16 sm:py-20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">{copy.featuresEyebrow}</p>
          <h2 id="auth-features-title" className={`mt-3 max-w-3xl text-3xl font-extrabold leading-tight sm:text-4xl ${khmer ? 'font-khmer' : 'font-display'}`}>{copy.featuresTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {copy.features.map(([title, detail], index) => {
              const Icon = icons[index];
              return <article key={title} className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 shadow-lg backdrop-blur-sm">
                <Icon size={28} className="text-orange-300" aria-hidden="true" />
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-white/75">{detail}</p>
              </article>;
            })}
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="auth-steps-title" className="scroll-mt-8 border-t border-white/15 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">{copy.stepsEyebrow}</p>
              <h2 id="auth-steps-title" className={`mt-3 max-w-xl text-3xl font-extrabold leading-tight sm:text-4xl ${khmer ? 'font-khmer' : 'font-display'}`}>{copy.stepsTitle}</h2>
              <p className="mt-5 max-w-xl leading-7 text-white/75">{copy.stepsIntro}</p>
            </div>
            <div className="grid gap-4">
              {copy.steps.map(([title, detail], index) => <article key={title} className="flex gap-5 rounded-2xl border border-white/15 bg-white/[0.06] p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-400/20 font-bold text-orange-200">{index + 1}</span>
                <div><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm leading-7 text-white/75">{detail}</p></div>
              </article>)}
            </div>
          </div>
        </section>

        <section aria-label={copy.responsibilityTitle} className="grid gap-4 border-t border-white/15 py-16 lg:grid-cols-2">
          <article className="rounded-3xl border border-orange-300/25 bg-orange-400/[0.07] p-7">
            <ShieldCheck size={32} className="text-orange-300" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold">{copy.responsibilityTitle}</h2>
            <p className="mt-4 leading-7 text-white/75">{copy.responsibilityBody}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {copy.commitments.map((item) => <p key={item} className="flex gap-2 text-sm text-white/80"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-orange-300" aria-hidden="true" />{item}</p>)}
            </div>
          </article>
          <article className="rounded-3xl border border-white/15 bg-white/[0.06] p-7">
            <h2 className="text-2xl font-bold">{copy.dataTitle}</h2>
            <p className="mt-4 leading-7 text-white/75">{copy.dataBody}</p>
            <a href="/privacy-policy" className="mt-6 inline-flex items-center gap-2 font-semibold text-orange-200 hover:underline">{copy.privacy}<ArrowRight size={17} aria-hidden="true" /></a>
            <p className="mt-8 border-t border-white/15 pt-5 text-sm text-white/70">{copy.operatedBy}: aime.angkorgate<br />{copy.support}: <a href="mailto:dymalis88@gmail.com" className="hover:underline">dymalis88@gmail.com</a></p>
          </article>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-white/15 py-8 text-xs text-white/60 sm:text-sm">
          <p>© 2026 aime.angkorgate</p>
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="/privacy-policy" className="hover:text-white">{copy.privacy}</a>
            <a href="/terms-of-service" className="hover:text-white">{copy.terms}</a>
            <a href="mailto:dymalis88@gmail.com" className="hover:text-white">{copy.support}</a>
          </nav>
        </footer>
      </div>
    </div>
  );
};

export default AuthInformation;
