import ContactForm from "@/components/contact/ContactForm";
import ContactHero from "@/components/contact/ContactHero";
import ContactInfo from "@/components/contact/ContactInfo";

export default function ContactPage() {
  return (
    <>
      <ContactHero />

      {/* Contact details and the API-backed message form sit side by side in the main content grid. */}
      <section className="contact-section">
        <div className="container">
          <div className="contact-grid">
            <ContactInfo />
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}
