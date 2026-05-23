import ContactForm from "@/components/contact/ContactForm";
import ContactInfo from "@/components/contact/ContactInfo";
import PageLayout from "@/components/PageLayout";
import { Section } from "@/components/ui/section";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Contact Quest Esports",
  description: defaultPageDescriptions.contact,
  path: "/contact",
  keywords: [
    "contact esports organizer",
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
    </PageLayout>
  );
}
