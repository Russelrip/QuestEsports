import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const policySections = [
  {
    title: "1. Scope",
    paragraphs: [
      "This Privacy Policy explains how Quest Esports collects, uses, stores, and shares personal information when you use questesports.lk, create an account, contact us, register for tournaments, or interact with our services.",
      "By using the website, you agree to the handling of information described here. If you do not agree, please do not use the services.",
    ],
  },
  {
    title: "2. Information We Collect",
    bullets: [
      "Account information such as first name, last name, email address, username, password hash, and optional profile details like phone number or Discord tag.",
      "Authentication and security data such as session records, sign-in history, IP address, user agent, verification tokens, password reset tokens, and multi-factor authentication data if you enable it.",
      "Tournament and team information such as team names, captain details, roster member details, Riot IDs, Discord handles, saved team information, and tournament registration status.",
      "Contact information and messages that you submit through the contact form or support channels.",
      "Uploaded content such as team logos, tournament banners, posters, and related media submitted or managed through the platform.",
      "Technical and usage information collected through hosting, analytics, performance monitoring, and server logs.",
    ],
  },
  {
    title: "3. Information From Social Login Providers",
    paragraphs: [
      "If you choose Google or Discord sign-in, we receive limited account information from that provider, such as your email address, provider user ID, display name details, and in some cases Discord identity details. We use that information only to authenticate you and create or connect your Quest Esports account.",
      "We do not control how Google or Discord use your information on their own platforms. Please review their privacy policies for more information.",
    ],
  },
  {
    title: "4. How We Use Information",
    bullets: [
      "To create and manage user accounts and allow secure sign-in.",
      "To organise tournaments, review registrations, contact captains, and manage rosters and invites.",
      "To respond to inquiries, support requests, and operational communications.",
      "To send account-related emails such as verification, password reset, security alerts, and invite notifications.",
      "To maintain platform security, prevent abuse, investigate suspicious activity, and enforce our rules.",
      "To understand website performance and improve the user experience.",
      "To comply with legal obligations and protect Quest Esports, participants, and the community.",
    ],
  },
  {
    title: "5. Legal Bases",
    paragraphs: [
      "Where applicable law requires a legal basis for processing, Quest Esports relies on grounds such as consent, performance of a contract, legitimate interests, legal obligations, and protection of vital interests.",
      "Our legitimate interests include operating tournaments fairly, securing the platform, preventing fraud or misuse, and improving reliability and user experience.",
    ],
  },
  {
    title: "6. Cookies and Tracking Technologies",
    paragraphs: [
      "Quest Esports uses cookies or similar technologies that are necessary to keep you signed in, remember sessions, protect account security, and support basic site functionality.",
      "We may also use analytics and performance tools to understand traffic, reliability, and usage trends. We do not state in this policy that we sell personal information or run third-party behavioural advertising.",
    ],
  },
  {
    title: "7. When We Share Information",
    bullets: [
      "With service providers that help us operate the website, such as hosting, analytics, email delivery, and infrastructure partners.",
      "With tournament admins, referees, or organisers when access is needed to review registrations, verify eligibility, or manage competitive operations.",
      "With authentication providers when you choose social login.",
      "If required by law, regulation, court order, or to protect rights, safety, and platform integrity.",
      "In connection with a merger, financing, acquisition, or other business transfer if one occurs.",
    ],
    paragraphs: [
      "We do not sell your personal information.",
    ],
  },
  {
    title: "8. Public and Community-Facing Content",
    paragraphs: [
      "Some tournament-related information may be displayed publicly or shared within the Quest Esports community when needed for event operations or promotion. This can include team names, tournament placements, posters, brackets, and other event-related content that you submit or participate in.",
      "This policy does not state that all users can freely browse broad public profile data or social-network activity feeds, because that would overstate how the current platform works.",
    ],
  },
  {
    title: "9. International Transfers",
    paragraphs: [
      "Quest Esports may store or process information in countries other than your own because our service providers, hosting providers, analytics providers, email delivery providers, and authentication providers may operate internationally.",
      "Where required, we take reasonable steps to protect personal information when international transfers occur.",
    ],
  },
  {
    title: "10. Data Retention",
    paragraphs: [
      "We keep personal information for as long as reasonably necessary for account management, tournament administration, security, dispute handling, recordkeeping, and legal compliance.",
      "In general, account-related information may be kept while you maintain an account with us, and some records may be retained longer where reasonably necessary for security, fraud prevention, or legal obligations.",
    ],
  },
  {
    title: "11. Security",
    paragraphs: [
      "We use reasonable administrative, technical, and organisational measures to protect personal information, including password hashing, session controls, verification workflows, multi-factor authentication support, and security monitoring.",
      "No online system is completely secure, so we cannot guarantee absolute security.",
    ],
  },
  {
    title: "12. Children and Young Players",
    paragraphs: [
      "Quest Esports may host tournaments involving younger players. If you are under the age required to consent under applicable law, please use the service with the involvement of a parent or guardian.",
      "Where tournament rules require parental consent or age-related verification, those requirements still apply.",
    ],
  },
  {
    title: "13. Your Rights and Choices",
    bullets: [
      "You can update parts of your account information from your profile.",
      "You can choose whether to use optional profile fields such as phone number or Discord tag.",
      "You can contact us to request account assistance, data correction, or deletion review.",
      "Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or request a copy of certain personal information.",
    ],
  },
  {
    title: "14. Requests and Appeals",
    paragraphs: [
      "You can contact Quest Esports through the contact form or by email to make privacy-related requests. We may need to verify your identity before acting on a request.",
      "If applicable law gives you a right to appeal a privacy-request decision, you may contact us at contact@mail.questesports.lk and clearly state that your message is an appeal.",
    ],
  },
  {
    title: "15. Changes to This Policy",
    paragraphs: [
      "We may update this Privacy Policy from time to time. When we make material changes, we will update the effective date on this page and may provide additional notice where appropriate.",
    ],
  },
];

export default function PrivacyPolicyContent() {
  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Last Updated</p>
          <h2 className="mt-3 text-3xl text-white">May 26, 2026</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
            This policy applies to the Quest Esports website at <span className="text-white">questesports.lk</span> and related
            tournament and account services.
          </p>
        </Card>

        {policySections.map((section) => (
          <Card key={section.title} className="p-6 sm:p-8">
            <h3 className="text-2xl text-white">{section.title}</h3>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-300">
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="mt-5 grid gap-2 text-sm leading-7 text-slate-300">
                {section.bullets.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">16. Contact Us</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            If you have questions about this Privacy Policy or want to request help with your data, contact us at{" "}
            <a href="mailto:contact@mail.questesports.lk" className="text-cyan-200 transition hover:text-cyan-100">
              contact@mail.questesports.lk
            </a>{" "}
            or use the{" "}
            <Link href="/contact" className="text-cyan-200 transition hover:text-cyan-100">
              contact page
            </Link>
            .
          </p>
        </Card>
      </div>
    </Section>
  );
}
