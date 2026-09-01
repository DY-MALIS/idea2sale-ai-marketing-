import { ArrowLeft } from 'lucide-react';

type LegalPageProps = {
  type: 'terms' | 'privacy';
};

const legalContent = {
  terms: {
    title: 'Terms of Service',
    updated: 'Last updated: September 1, 2026',
    intro: 'These Terms of Service ("Terms") govern your access to and use of aime.angkorgate, an AI-assisted marketing, content creation, scheduling, analytics, and publishing service. By creating an account or using the service, you agree to these Terms. If you do not agree, do not use the service.',
    sections: [
      {
        title: 'Service Provider and Contact',
        body: 'The service is operated under the name aime.angkorgate. Questions about these Terms may be sent to dymalis88@gmail.com. We may use this address to communicate about support, legal notices, and account matters.',
      },
      {
        title: 'Eligibility',
        body: 'You must be at least 18 years old, or the age of legal majority where you live, and able to enter into a binding agreement. If you use the service for an organization, you confirm that you have authority to accept these Terms for that organization.',
      },
      {
        title: 'Use of the Service',
        body: 'You may use the service to create, plan, analyze, schedule, and manage marketing content. Features and availability may change over time. You are responsible for reviewing every output and publishing instruction before use and for complying with applicable laws, advertising rules, and platform policies.',
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
        title: 'Your Content and Permissions',
        body: 'You retain ownership of content you submit. You grant us a limited, worldwide, non-exclusive licence to host, process, reproduce, and transmit that content only as needed to operate, secure, and improve the service and perform actions you request. You confirm that you have all rights and permissions necessary for content you upload or publish.',
      },
      {
        title: 'Our Intellectual Property',
        body: 'The service, software, design, branding, and related materials are owned by or licensed to aime.angkorgate. Except for the limited right to use the service under these Terms, no intellectual-property rights are transferred to you.',
      },
      {
        title: 'Third-Party Services',
        body: 'The service may connect with platforms such as Google, Firebase, TikTok, and other providers. Your use of those services is also governed by their own terms and policies.',
      },
      {
        title: 'Acceptable Use',
        body: 'You must not use the service for unlawful, deceptive, harmful, infringing, abusive, fraudulent, or spam-related activity; impersonation; unauthorized surveillance; malware; security testing without permission; or content that violates another person’s rights. You must not attempt to bypass access controls or platform restrictions.',
      },
      {
        title: 'Fees and Paid Features',
        body: 'If paid features are offered, prices, billing intervals, renewal terms, and cancellation options will be shown before purchase. Unless required by law or stated otherwise at purchase, fees already paid are non-refundable. You remain responsible for taxes that apply to your purchase.',
      },
      {
        title: 'Suspension and Termination',
        body: 'You may stop using the service at any time. We may suspend or terminate access when reasonably necessary to address a Terms violation, security risk, legal requirement, non-payment, harm to another user or platform, or discontinuation of the service. Provisions that by their nature should survive termination will remain in effect.',
      },
      {
        title: 'Disclaimers and Limitation of Liability',
        body: 'The service is provided "as is" and "as available" without warranties to the extent permitted by law. We do not guarantee uninterrupted availability, platform approval, reach, revenue, or accuracy of AI output. To the maximum extent allowed by law, aime.angkorgate is not liable for indirect, incidental, special, consequential, exemplary, or business-loss damages arising from use of the service. Nothing in these Terms excludes liability that cannot legally be excluded.',
      },
      {
        title: 'Indemnity',
        body: 'To the extent permitted by law, you agree to defend and indemnify aime.angkorgate against third-party claims, losses, and reasonable costs resulting from your content, your unlawful use of the service, or your material violation of these Terms.',
      },
      {
        title: 'Governing Law and Disputes',
        body: 'These Terms are governed by the laws applicable where the service operator is established, without regard to conflict-of-law rules. Before starting formal proceedings, you agree to contact us at dymalis88@gmail.com and make a good-faith effort to resolve the dispute. Mandatory consumer protections in your country remain unaffected.',
      },
      {
        title: 'Changes to These Terms',
        body: 'We may update these Terms when the service, law, or our practices change. We will post the revised version and update the date above. For material changes, we will provide reasonable notice where required. Continued use after the effective date means you accept the updated Terms.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updated: 'Last updated: September 1, 2026',
    intro: 'This Privacy Policy explains how aime.angkorgate collects, uses, shares, retains, and protects personal information when you visit our website or use our AI-assisted marketing, analytics, scheduling, and publishing tools. It also explains your privacy choices and rights.',
    sections: [
      {
        title: 'Who Is Responsible for Your Data',
        body: 'aime.angkorgate is the controller of personal information processed for this service. For privacy questions, access requests, correction requests, objections, or deletion requests, email dymalis88@gmail.com. We may ask for information needed to verify that a request relates to your account.',
      },
      {
        title: 'Information We Collect',
        body: 'We collect information you provide, such as your name, email address, profile image, business profile, prompts, campaign information, uploaded media, generated content, schedules, support messages, and account preferences. We also collect technical information such as device and browser type, IP-derived information, timestamps, feature activity, error records, and security logs.',
      },
      {
        title: 'TikTok and Other Connected-Platform Data',
        body: 'When you choose to connect TikTok, we may receive and process your TikTok user identifier, display name, avatar, authorization scopes, access and refresh tokens, token-expiry information, public profile or statistics made available under approved permissions, and details needed to upload, publish, or track content you request. We process equivalent identifiers, tokens, content, and activity data for other platforms you voluntarily connect. We do not sell connected-platform data.',
      },
      {
        title: 'How We Use Information',
        body: 'We use information to create and secure accounts; provide requested AI output; store drafts and schedules; connect accounts; upload or publish content at your direction; display available analytics; provide support; prevent fraud and abuse; diagnose errors; comply with legal obligations; and improve reliability. We do not use TikTok data for unrelated advertising or sell it to data brokers.',
      },
      {
        title: 'Legal Bases for Processing',
        body: 'Where applicable law requires a legal basis, we process data to perform our agreement with you, based on your consent when you connect a platform or enable an optional feature, to comply with law, and for legitimate interests such as security, fraud prevention, support, and service improvement where those interests are not overridden by your rights.',
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
        title: 'How We Share Information',
        body: 'We share information only as needed with service providers that support hosting, authentication, databases, storage, AI generation, media processing, analytics, communications, and security; with connected platforms when you request an action; when required by law or to protect rights and safety; or as part of a business transaction subject to appropriate safeguards. Providers may process data only for contracted services and applicable legal obligations.',
      },
      {
        title: 'Data Retention',
        body: 'We retain account information while your account is active and for a reasonable period afterward where necessary for security, dispute resolution, legal compliance, or backup recovery. Drafts, media, schedules, platform records, and tokens are retained only while needed to provide the requested feature or until you delete them, disconnect the platform, or request account deletion, subject to limited backup and legal-retention periods. Security logs may be retained for a reasonable period to investigate abuse.',
      },
      {
        title: 'Data Storage and Security',
        body: 'We use reasonable technical and organizational safeguards, including access controls, encrypted network connections, restricted server-side credentials, and monitoring designed to protect data. No internet service can guarantee absolute security. You should protect your own credentials and promptly disconnect any account you believe is compromised.',
      },
      {
        title: 'International Data Transfers',
        body: 'Our service providers may process information in countries other than your own. Where required, we rely on recognized safeguards for international transfers, such as contractual protections, adequacy decisions, or another lawful transfer mechanism.',
      },
      {
        title: 'Your Rights and Choices',
        body: 'Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a copy of your personal information and to withdraw consent. You may decline optional connections, revoke access in the connected platform, or email dymalis88@gmail.com. You may also complain to your local data-protection authority. We will not discriminate against you for exercising privacy rights.',
      },
      {
        title: 'Disconnecting TikTok and Deleting Data',
        body: 'You can revoke aime.angkorgate access from your TikTok account settings. To request deletion of data associated with TikTok or your aime.angkorgate account, email dymalis88@gmail.com from the address connected to your account and state that you want your account or TikTok-connected data deleted. After verification, we will delete or de-identify applicable data unless retention is required by law, security needs, or an unresolved transaction. Revoking access stops future collection but may not automatically delete previously stored records, so send a deletion request if you want those records removed.',
      },
      {
        title: 'Cookies and Local Storage',
        body: 'We may use cookies and similar browser storage that are necessary for sign-in, security, language, theme, session continuity, and saved preferences. Where required, optional analytics technologies will be used only with appropriate notice or consent. You may control cookies through your browser, although disabling necessary storage can prevent features from working.',
      },
      {
        title: 'Children’s Privacy',
        body: 'The service is not directed to children under 13 and is intended for users who can legally enter into these Terms. We do not knowingly collect personal information from children under 13. If you believe a child has provided information, contact dymalis88@gmail.com so we can investigate and delete it where required.',
      },
      {
        title: 'Changes to This Policy',
        body: 'We may update this Privacy Policy when our service, providers, or legal obligations change. We will publish the revised policy with a new effective date and provide additional notice for material changes where required.',
      },
    ],
  },
};

const LegalPage = ({ type }: LegalPageProps) => {
  const content = legalContent[type];

  return (
    <main className="min-h-screen bg-mesh px-6 py-10 text-slate-700 dark:text-slate-300">
      <div className="mx-auto max-w-3xl">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-bold text-brand-700 shadow-sm transition-colors hover:bg-white dark:bg-slate-800/80 dark:text-brand-400 dark:hover:bg-slate-700"
        >
          <ArrowLeft size={16} />
          Back to aime.angkorgate
        </a>

        <article className="rounded-[2rem] border border-white/60 bg-white/90 p-8 shadow-xl md:p-12 dark:border-slate-700 dark:bg-slate-800/90">
          <div className="mb-6 flex items-center gap-3">
            <img src="/favicon.svg" alt="aime.angkorgate icon" className="h-12 w-12 rounded-xl shadow-sm" />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-500">aime.angkorgate</p>
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-brand-700 md:text-5xl dark:text-brand-400">{content.title}</h1>
          <p className="mt-3 text-sm font-semibold text-slate-400 dark:text-slate-400">{content.updated}</p>
          <p className="mt-8 text-base leading-8 text-slate-600 dark:text-slate-300">{content.intro}</p>

          <div className="mt-10 space-y-8">
            {content.sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-bold text-brand-700 dark:text-brand-400">{section.title}</h2>
                <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{section.body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
};

export default LegalPage;
