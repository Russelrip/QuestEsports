import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const termsSections = [
  {
    title: "1. Acceptance of These Terms",
    paragraphs: [
      "These Terms of Service govern your use of questesports.lk and related Quest Esports services. By accessing or using the website, creating an account, registering for tournaments, or submitting content through the platform, you agree to be bound by these terms.",
      "If you do not agree to these terms, please do not use the website or services.",
    ],
  },
  {
    title: "2. Eligibility and Accounts",
    bullets: [
      "You must provide accurate, current, and complete information when creating an account or using the services.",
      "You are responsible for maintaining the confidentiality of your account credentials and for activity carried out through your account.",
      "Quest Esports may suspend, restrict, or terminate accounts that violate these terms, applicable tournament rules, or platform security requirements.",
      "Where tournament rules require parental or guardian involvement for younger players, those requirements remain your responsibility.",
    ],
  },
  {
    title: "3. Tournament Participation",
    paragraphs: [
      "Quest Esports organises competitive gaming events and related community operations. Tournament participation is also subject to the official rulebook, event-specific requirements, and organiser decisions needed to preserve fairness, safety, scheduling, and competitive integrity.",
    ],
    bullets: [
      "Registration information must be truthful and submitted by authorised team representatives.",
      "Quest Esports may verify identity, eligibility, roster status, or compliance with event rules where necessary.",
      "Tournament schedules, formats, eligibility rules, and operational requirements may change when reasonably necessary.",
      "Failure to follow tournament rules or organiser instructions may lead to warnings, disqualification, account restrictions, or removal from an event.",
    ],
  },
  {
    title: "4. User Content and Submissions",
    paragraphs: [
      "You may submit information and content through the platform, including registration details, team information, contact messages, team logos, and other tournament-related materials.",
    ],
    bullets: [
      "You must have the right to submit any content or material you provide.",
      "You must not submit unlawful, deceptive, infringing, abusive, or harmful content.",
      "Quest Esports may review, remove, refuse, or moderate submissions where reasonably necessary for platform operations, legal compliance, safety, or tournament administration.",
      "By submitting tournament-related content, you allow Quest Esports to use it for tournament administration, event promotion, and community-facing coverage connected to Quest Esports activities.",
    ],
  },
  {
    title: "5. Acceptable Use",
    bullets: [
      "Do not misuse the website, attempt unauthorised access, interfere with service operation, or bypass security controls.",
      "Do not impersonate another person, submit false information, or use another person's account without permission.",
      "Do not use the services to harass, abuse, threaten, or disrupt other participants, staff, or community members.",
      "Do not upload malicious code, spam, or content intended to damage systems or deceive users.",
    ],
  },
  {
    title: "6. Social Login and Third-Party Services",
    paragraphs: [
      "Quest Esports may offer login or related features through third-party services such as Google or Discord. Your use of those third-party services remains subject to their own terms and privacy policies.",
      "Quest Esports is not responsible for third-party services, websites, or external platforms that are not under its control.",
    ],
  },
  {
    title: "7. Intellectual Property",
    paragraphs: [
      "Unless otherwise stated, Quest Esports and its licensors retain rights in the website, branding, platform content, original media, design, text, graphics, and service materials.",
      "You may not copy, republish, distribute, modify, reverse engineer, or commercially exploit protected website materials except as allowed by law or with prior permission.",
    ],
  },
  {
    title: "8. Service Availability and Changes",
    paragraphs: [
      "Quest Esports may update, modify, suspend, or discontinue parts of the website or services at any time. We do not guarantee uninterrupted availability, continuous uptime, or error-free operation.",
      "We may make operational, design, security, or content changes whenever reasonably necessary.",
    ],
  },
  {
    title: "9. Disclaimers",
    paragraphs: [
      "The services are provided on an as-available and as-is basis to the extent permitted by applicable law. Quest Esports does not guarantee that the platform will always be available, secure, or free from errors, delays, or interruptions.",
      "Tournament participation, external platform dependencies, email delivery, hosting, and third-party integrations may be affected by factors outside our direct control.",
    ],
  },
  {
    title: "10. Limitation of Liability",
    paragraphs: [
      "To the extent permitted by applicable law, Quest Esports will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising from your use of the website, participation in events, inability to access services, or reliance on platform content.",
      "Nothing in these terms is intended to exclude liability that cannot be lawfully excluded under applicable law.",
    ],
  },
  {
    title: "11. Privacy",
    paragraphs: [
      "Your use of the services is also subject to the Quest Esports Privacy Policy, which explains how personal information is collected, used, stored, and shared.",
    ],
  },
  {
    title: "12. Termination",
    paragraphs: [
      "You may stop using the services at any time. Quest Esports may suspend or terminate access where reasonably necessary for rule enforcement, security, legal compliance, abuse prevention, or operational reasons.",
      "Sections that by their nature should continue after termination, including provisions relating to content rights, liability, privacy, and dispute-related matters, will survive termination where applicable.",
    ],
  },
  {
    title: "13. Changes to These Terms",
    paragraphs: [
      "Quest Esports may update these Terms of Service from time to time. When we make material changes, we will update the effective date on this page and may provide additional notice where appropriate.",
    ],
  },
];

export default function TermsOfServiceContent() {
  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Last Updated</p>
          <h2 className="mt-3 text-3xl text-white">May 26, 2026</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
            These terms apply to the Quest Esports website at <span className="text-white">questesports.lk</span> and related
            tournament and account services.
          </p>
        </Card>

        {termsSections.map((section) => (
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
          <h3 className="text-2xl text-white">14. Contact Us</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            If you have questions about these Terms of Service, contact us at{" "}
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
