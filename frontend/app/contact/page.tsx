import ContactForm from "@/components/contact/ContactForm";
import ContactInfo from "@/components/contact/ContactInfo";
import PageLayout from "@/components/PageLayout";
import { Section } from "@/components/ui/section";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import JoinQuestSection from "@/components/home/JoinQuestSection";
import Link from "next/link";
import { Card } from "@/components/ui/card";

export const metadata = buildPageMetadata({
  title: "Contact Quest E-sports",
  description: defaultPageDescriptions.contact,
  path: "/contact",
  keywords: [
    "contact e-sports organizer",
    "gaming sponsorship inquiry",
    "tournament support",
    "creator collaboration",
  ],
});

export default function ContactPage() {
  return (
    <PageLayout title="Contact Us" description={defaultPageDescriptions.contact}>
      <Section className="pt-6">
        <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <ContactInfo />
          <ContactForm />
        </div>
      </Section>
      <Section>
        <div className="mb-6"><p className="text-xs uppercase tracking-[0.28em] text-purple-200">Recruitment</p><h2 className="mt-3 text-3xl text-white">Choose the application that fits your roster.</h2></div>
        <div className="grid gap-5 md:grid-cols-3">{[
          ["Solo Player", "Apply as an individual looking for a competitive team.", "solo_player"],
          ["Existing Team", "Bring an established roster into the Quest ecosystem.", "existing_team"],
          ["Incomplete Team", "Recruit the missing players needed to complete your lineup.", "incomplete_team"],
        ].map(([title, description, type]) => <Link key={type} href={`/join?type=${type}`}><Card className="h-full p-6 transition hover:-translate-y-1 hover:border-purple-300/35"><h3 className="text-2xl text-white">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-400">{description}</p><p className="mt-6 text-sm font-semibold text-purple-200">Start application →</p></Card></Link>)}</div>
      </Section>
      <JoinQuestSection />
    </PageLayout>
  );
}
