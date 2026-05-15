import { ArrowLeft } from 'lucide-react';

type LegalPageProps = {
  type: 'terms' | 'privacy';
};

const legalContent = {
  terms: {
    title: 'Terms of Service',
    updated: 'Last updated: May 13, 2026',
    intro: 'These Terms of Service govern your access to and use of AIME by Angkor Gate, including Idea2Sale marketing, scheduling, analytics, and AI-assisted content tools.',
    sections: [
      {
        title: 'Use of the Service',
        body: 'You may use the service to create, plan, analyze, and manage marketing content. You are responsible for the content you submit, generate, publish, or schedule through the service.',
      },
      {
        title: 'Accounts and Access',
        body: 'Some features may require authentication through Google, Firebase, or connected third-party platforms. You are responsible for keeping your account access secure and for all activity under your account.',
      },
      {
        title: 'AI-Generated Content',
        body: 'AI outputs may be inaccurate, incomplete, or unsuitable for your specific use. You should review all generated content before publishing, advertising, or relying on it for business decisions.',
      },
      {
        title: 'Third-Party Services',
        body: 'The service may connect with platforms such as Google, Firebase, TikTok, and other providers. Your use of those services is also governed by their own terms and policies.',
      },
      {
        title: 'Acceptable Use',
        body: 'Do not use the service for unlawful, deceptive, harmful, infringing, abusive, or spam-related activity. We may restrict access if use of the service creates risk for users, platforms, or our systems.',
      },
      {
        title: 'Limitation of Liability',
        body: 'The service is provided as-is. To the maximum extent allowed by law, Angkor Gate is not liable for indirect, incidental, special, consequential, or business-loss damages arising from use of the service.',
      },
      {
        title: 'Contact',
        body: 'For questions about these terms, contact Angkor Gate through the official AIME website or support channels.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updated: 'Last updated: May 13, 2026',
    intro: 'This Privacy Policy explains how AIME by Angkor Gate collects, uses, and protects information when you use Idea2Sale and related AI marketing tools.',
    sections: [
      {
        title: 'Information We Collect',
        body: 'We may collect account information, authentication details, app settings, content you create, prompts you submit, analytics data, and connected platform data needed to provide the service.',
      },
      {
        title: 'How We Use Information',
        body: 'We use information to operate the service, authenticate users, generate AI-assisted outputs, save schedules and campaigns, improve reliability, protect against abuse, and provide support.',
      },
      {
        title: 'Connected Platforms',
        body: 'If you connect third-party platforms, we may process tokens, identifiers, analytics, or publishing data needed to perform the actions you request. You can revoke access through the third-party platform settings.',
      },
      {
        title: 'AI Processing',
        body: 'Prompts, uploaded content, campaign details, and related inputs may be sent to AI providers to generate requested outputs. Avoid submitting sensitive personal data unless necessary.',
      },
      {
        title: 'Data Storage and Security',
        body: 'We use reasonable technical and organizational measures to protect data. No internet service can guarantee absolute security, so you should also protect your own account credentials and connected services.',
      },
      {
        title: 'Your Choices',
        body: 'You may choose not to connect third-party accounts, use guest or demo features where available, request deletion where applicable, and manage permissions through connected provider consoles.',
      },
      {
        title: 'Contact',
        body: 'For privacy questions or requests, contact Angkor Gate through the official AIME website or support channels.',
      },
    ],
  },
};

const LegalPage = ({ type }: LegalPageProps) => {
  const content = legalContent[type];

  return (
    <main className="min-h-screen bg-mesh px-6 py-10 text-slate-700">
      <div className="mx-auto max-w-3xl">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-brand-700 shadow-sm transition-colors hover:bg-white"
        >
          <ArrowLeft size={16} />
          Back to Idea2Sale
        </a>

        <article className="rounded-[2rem] border border-white/60 bg-white/90 p-8 shadow-xl md:p-12">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-brand-500">AIME by Angkor Gate</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-700 md:text-5xl">{content.title}</h1>
          <p className="mt-3 text-sm font-semibold text-slate-400">{content.updated}</p>
          <p className="mt-8 text-base leading-8 text-slate-600">{content.intro}</p>

          <div className="mt-10 space-y-8">
            {content.sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-bold text-brand-700">{section.title}</h2>
                <p className="mt-3 leading-7 text-slate-600">{section.body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
};

export default LegalPage;
