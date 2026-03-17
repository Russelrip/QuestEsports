import ContactForm from "@/components/contact/ContactForm";
import ContactInfo from "@/components/contact/ContactInfo";
import PageLayout from "@/components/PageLayout";
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
      <section className="contact-section">
        <div className="container">
          <div className="contact-grid">
            <ContactInfo />
            <ContactForm />
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
