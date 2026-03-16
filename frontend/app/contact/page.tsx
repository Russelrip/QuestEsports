import ContactForm from "@/components/contact/ContactForm";
import ContactInfo from "@/components/contact/ContactInfo";
import PageLayout from "@/components/PageLayout";
import { defaultPageDescriptions } from "@/lib/site";

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
