import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const policySections = [
  {
    title: "1. Scope",
    paragraphs: [
      "This Privacy Policy explains how Quest E-sports collects, uses, stores, and shares personal information when you use questesports.lk, create an account, contact us, register for tournaments, connect a game account, or interact with our services.",
      "By using the website, you agree to the handling of information described here. If you do not agree, please do not use the services.",
    ],
  },
  {
    title: "2. Information We Collect",
    bullets: [
      "Account information such as first name, last name, email address, username, password hash, and optional profile details like phone number or Discord tag.",
      "Authentication and security data such as session records, sign-in history, IP address, user agent, verification tokens, and password reset tokens.",
      "Tournament, recruitment, and team information such as team names, captain details, roster member details, NICs submitted with the relevant member's permission for recruitment review, saved team information, and application or registration status.",
      "Game identifiers, such as an in-game name or player ID, collected by a tournament whose rules require one. These are recorded against that registration and its historical record. A saved team does not collect or store them, so entering a later event for a different game asks again rather than reusing an earlier answer.",
      "A Discord handle shown against a roster member comes from that member's own connected Discord account, not from anything a captain typed about them.",
      "Connected game account details, described in section 4, and the competitive ranking information derived from them.",
      "Contact information and messages that you submit through the contact form, support conversations, or support channels, including any files you attach to a support message.",
      "Match-day communications such as match room messages, veto room selections and actions, and the participation records that show who was present in a room.",
      "Uploaded content such as team logos, tournament banners, posters, event album photographs, and private bank-transfer receipts submitted for payment verification.",
      "Commerce information such as merchandise selections, delivery address, entrance-ticket orders, QR ticket and check-in status, order totals, payment status, and payment-provider references. Quest E-sports does not store full card numbers or security codes.",
      "Notification data such as your notification preferences and, if you enable browser notifications, the push subscription endpoint and encryption keys your browser issues along with the browser or device description attached to it.",
      "Administrative records of staff actions, including the staff member responsible, what changed, the reason given, and the request context such as IP address. These records exist to keep privileged actions accountable.",
      "Technical and usage information collected through hosting, performance monitoring, and server logs.",
    ],
  },
  {
    title: "3. Information From Social Login Providers",
    paragraphs: [
      "If you choose Google or Discord sign-in, we receive limited account information from that provider, such as your email address, provider user ID, display name details, and in some cases Discord identity details. We use that information only to authenticate you and create or connect your Quest E-sports account.",
      "We do not control how Google or Discord use your information on their own platforms. Please review their privacy policies for more information.",
    ],
  },
  {
    title: "4. Connected Game and Discord Accounts",
    paragraphs: [
      "Connecting a game account is optional and is something you do from your profile. It is what makes competitive features such as rankings and the leaderboard available to you.",
    ],
    bullets: [
      "When you connect a VALORANT account, we store the stable account identifier issued by the game publisher together with a cached copy of your Riot ID, tagline, and region, the verification status of the link, and the times the link was made and last refreshed. The stable identifier is used internally to keep a link accurate across name changes; it is not displayed on public pages.",
      "We store a cached snapshot of competitive standing obtained for that account, which can include current rank tier, rating, Sri Lanka ranking position, peak and seasonal ranks, the time of the most recent recorded match, and the time the snapshot was taken.",
      "One game account can be connected to one Quest E-sports player. This limit exists to prevent two people claiming the same account and to keep competitive records attached to the right person.",
      "A connected Discord account is kept as tournament infrastructure separate from sign-in, so that organisers and referees can still reach a player whose account arrangements later change. We store the Discord account identifier with a cached copy of the username and display name.",
      "Replacing or disconnecting a connected account keeps the earlier link as history rather than deleting the competitive record it is attached to.",
    ],
  },
  {
    title: "5. Public Leaderboards and Player Profiles",
    paragraphs: [
      "Quest E-sports publishes a Sri Lanka VALORANT leaderboard and player profile pages. Appearing on them follows from connecting a game account, so it is a choice you make rather than something applied to every account.",
    ],
    bullets: [
      "A leaderboard entry can publicly show a Riot ID and tagline, region, Discord username, current rank tier, rating, ranking position, peak and seasonal ranks, and when the player last played a recorded match.",
      "A player profile page can publicly show a Quest player identifier, display name, connected Riot ID, teams, tournament history, and cached ranking information with the time it was taken.",
      "Ranking information is obtained from third-party VALORANT data services and refreshed periodically, so a published value is a snapshot rather than a live reading.",
      "Quest E-sports staff can hide an entry from the public board while it stays registered, or remove it entirely, for reasons such as a falsified identity, a breach of tournament rules, or a request we accept. A record of a removed entry is kept so that an incorrect removal can be reversed, and the entry is also present in routine encrypted backups until those expire.",
      "You can ask us to hide or remove your leaderboard entry, or disconnect the game account behind it, using the contact details in this policy.",
    ],
  },
  {
    title: "6. Notifications and Messages We Send",
    bullets: [
      "Account and security emails such as verification, email-change confirmation, password reset, and security alerts.",
      "Operational messages about your registrations, orders, tickets, support conversations, and matches.",
      "In-app notifications, and browser push notifications if you enable them. Push messages are delivered through the push service your browser vendor operates, which necessarily receives the delivery endpoint and the encrypted message.",
      "You control match notification preferences from your profile, and you can revoke browser notification permission at any time from your browser settings, which ends push delivery to that browser.",
      "Team invitations are not emailed. An invitation is held in your Quest account and you find it by signing in.",
    ],
  },
  {
    title: "7. How We Use Information",
    bullets: [
      "To create and manage user accounts and allow secure sign-in.",
      "To organise tournaments, review recruitment applications and registrations, contact applicants or captains, and manage rosters and invites.",
      "To verify connected game accounts, calculate and publish competitive rankings, and keep leaderboard and profile information current.",
      "To operate match rooms and veto rooms, record the selections that decide a match, and resolve disputes about what happened during an event.",
      "To respond to inquiries, support requests, and operational communications.",
      "To send the account, operational, and notification messages described in section 6.",
      "To maintain platform security, prevent abuse, investigate suspicious activity, keep privileged staff actions accountable, and enforce our rules.",
      "To understand website performance and improve the user experience.",
      "To process merchandise and entrance-ticket orders, arrange delivery, issue and verify event QR tickets, record check-ins, reconcile PayHere payments, verify tournament bank transfers, detect duplicate receipts, and provide payment support.",
      "To comply with legal obligations and protect Quest E-sports, participants, and the community.",
    ],
  },
  {
    title: "8. Legal Bases",
    paragraphs: [
      "Where applicable law requires a legal basis for processing, Quest E-sports relies on grounds such as consent, performance of a contract, legitimate interests, legal obligations, and protection of vital interests.",
      "Our legitimate interests include operating tournaments fairly, securing the platform, preventing fraud or misuse, and improving reliability and user experience.",
    ],
  },
  {
    title: "9. Cookies and Similar Technologies",
    paragraphs: [
      "Quest E-sports uses cookies or similar technologies that are necessary to keep you signed in, remember sessions, protect account security, and support basic site functionality.",
      "If you enable browser notifications, the site installs a service worker in your browser to deliver them. It is not installed otherwise, and you can remove it by clearing this site's data in your browser settings.",
      "We may also use performance tools to understand traffic, reliability, and usage trends. We do not sell personal information and we do not run third-party behavioural advertising.",
    ],
  },
  {
    title: "10. When We Share Information",
    bullets: [
      "With service providers that help us operate the website, such as hosting, email delivery, payment processing, and infrastructure partners.",
      "With the third-party VALORANT data services we use to resolve a connected account and refresh its ranking. Looking up an account necessarily discloses that account's game identifier to the service performing the lookup.",
      "With the browser push service that delivers a notification you have enabled, as described in section 6.",
      "With tournament admins, referees, staff, or organisers when access is needed to review registrations, verify eligibility, or manage competitive operations. Staff access is limited by assigned role and recorded in our administrative records.",
      "With authentication providers when you choose social login.",
      "If required by law, regulation, court order, or to protect rights, safety, and platform integrity.",
      "In connection with a merger, financing, acquisition, or other business transfer if one occurs.",
    ],
    paragraphs: [
      "We do not sell your personal information.",
    ],
  },
  {
    title: "11. Public and Community-Facing Content",
    paragraphs: [
      "Some tournament-related information may be displayed publicly or shared within the Quest E-sports community when needed for event operations or promotion. This can include team names, tournament placements, posters, brackets, match results, published leaderboard and profile information, and other event-related content that you submit or participate in.",
      "Quest E-sports publishes photo albums from its events, which may include photographs of attendees and competitors taken at the venue. If you appear in a published photograph and would like it reviewed or removed, contact us using the details below.",
      "This policy does not state that all users can freely browse broad public profile data or social-network activity feeds, because that would overstate how the current platform works.",
    ],
  },
  {
    title: "12. Where Information Is Stored and International Transfers",
    paragraphs: [
      "Quest E-sports operates its own managed server infrastructure and keeps encrypted off-site copies of its data so the platform can be recovered after a failure. Backup copies are retained on a schedule and expire automatically.",
      "Quest E-sports may store or process information in countries other than your own because our hosting, backup, email delivery, payment, game data, and authentication providers may operate internationally.",
      "Where required, we take reasonable steps to protect personal information when international transfers occur.",
    ],
  },
  {
    title: "13. Data Retention",
    paragraphs: [
      "We keep personal information for as long as reasonably necessary for account management, tournament administration, security, dispute handling, recordkeeping, and legal compliance.",
      "In general, account-related information may be kept while you maintain an account with us. Payment receipts and related records are retained only for as long as reasonably necessary for verification, disputes, fraud prevention, accounting, or legal obligations, after which they are deleted or de-identified where appropriate. Recruitment applicants must confirm that every listed member permitted submission of that member's contact details and NIC.",
      "Competitive records such as match results, veto histories, registrations, and administrative records are retained as the historical record of an event, because removing them would misstate what happened. Deleted or removed information can also persist in encrypted backups until those backups expire on their normal schedule.",
    ],
  },
  {
    title: "14. Security",
    paragraphs: [
      "We use reasonable administrative, technical, and organisational measures to protect personal information, including password hashing, session controls, verification workflows, role-based staff access, database-level access restrictions, encrypted backups, and security monitoring.",
      "No online system is completely secure, so we cannot guarantee absolute security.",
    ],
  },
  {
    title: "15. Children and Young Players",
    paragraphs: [
      "Quest E-sports may host tournaments involving younger players. If you are under the age required to consent under applicable law, please use the service with the involvement of a parent or guardian.",
      "Where tournament rules require parental consent or age-related verification, those requirements still apply.",
    ],
  },
  {
    title: "16. Your Rights and Choices",
    bullets: [
      "You can update parts of your account information from your profile.",
      "You can choose whether to use optional profile fields such as phone number or Discord tag.",
      "You can connect or disconnect a game account, and ask us to hide or remove the leaderboard entry associated with it.",
      "You can change your notification preferences, and revoke browser notification permission from your browser settings.",
      "You can contact us to request account assistance, data correction, or deletion review.",
      "Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or request a copy of certain personal information.",
    ],
  },
  {
    title: "17. Requests and Appeals",
    paragraphs: [
      "You can contact Quest E-sports through the contact form or by email to make privacy-related requests. We may need to verify your identity before acting on a request.",
      "If applicable law gives you a right to appeal a privacy-request decision, you may contact us at questesports.lk@gmail.com and clearly state that your message is an appeal.",
    ],
  },
  {
    title: "18. Changes to This Policy",
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
          <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Last Updated</p>
          <h2 className="mt-3 text-3xl text-white">September 20, 2026</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
            This policy applies to the Quest E-sports website at <span className="text-white">questesports.lk</span> and related
            tournament, competitive ranking, and account services.
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
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-purple-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">19. Contact Us</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            If you have questions about this Privacy Policy or want to request help with your data, contact us at{" "}
            <a href="mailto:questesports.lk@gmail.com" className="text-purple-200 transition hover:text-purple-100">
              questesports.lk@gmail.com
            </a>{" "}
            or use the{" "}
            <Link href="/contact" className="text-purple-200 transition hover:text-purple-100">
              contact page
            </Link>
            .
          </p>
        </Card>
      </div>
    </Section>
  );
}
