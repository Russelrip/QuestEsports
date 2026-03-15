"use client";

import { FormEvent, useState } from "react";

type ContactFormData = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  const [formData, setFormData] = useState<ContactFormData>({
    name: "",
    email: "",
    subject: "",
    message: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    console.log("Contact form submitted:", formData);
    setSubmitted(true);
  };

  return (
    <>
      <section className="page-header">
        <h1>Contact Us</h1>
        <p>Get in touch with Quest Esports</p>
      </section>

      <section className="contact-section">
        <div className="container">
          <div className="contact-grid">
            <div className="contact-info">
              <h2>Contact Information</h2>

              <div className="info-item">
                <h3>Social Media</h3>

                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <img
                    src="/images/gmail.png"
                    alt="Gmail"
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                  />
                  <a href="mailto:questesportslk@gmail.com">
                    questesportslk@gmail.com
                  </a>
                </p>

                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <img
                    src="/images/discord.png"
                    alt="Discord"
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                  />
                  <a
                    href="https://discord.gg/cxkM7dk9CM"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Quest Esports Discord
                  </a>
                </p>

                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <img
                    src="/images/facebook.png"
                    alt="Facebook"
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                  />
                  <a
                    href="https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Quest E-Sports LK
                  </a>
                </p>

                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <img
                    src="/images/instagram.png"
                    alt="Instagram"
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                  />
                  <a
                    href="https://www.instagram.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @questesportslk
                  </a>
                </p>

                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "10px",
                  }}
                >
                  <img
                    src="/images/tiktok.png"
                    alt="TikTok"
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                  />
                  <a
                    href="https://www.tiktok.com/@senumii"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @senumii
                  </a>
                </p>
              </div>

              <div className="info-item">
                <h3
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <img
                    src="/images/whatsapp.png"
                    alt="WhatsApp"
                    style={{
                      width: "22px",
                      height: "22px",
                      objectFit: "contain",
                    }}
                  />
                  WhatsApp
                </h3>

                <p style={{ marginTop: "10px" }}>
                  <a
                    href="https://wa.me/94761195666"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    076 119 5666
                  </a>
                </p>
                <p>
                  <a
                    href="https://wa.me/94767186060"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    076 718 6060
                  </a>
                </p>
              </div>
            </div>

            <div className="contact-form-wrapper">
              <h2>Send us a Message</h2>

              <form
                id="contactForm"
                className="contact-form"
                onSubmit={handleSubmit}
              >
                <div className="form-group">
                  <label htmlFor="contactName">Name *</label>
                  <input
                    type="text"
                    id="contactName"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="contactEmail">Email *</label>
                  <input
                    type="email"
                    id="contactEmail"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="contactSubject">Subject *</label>
                  <input
                    type="text"
                    id="contactSubject"
                    name="subject"
                    required
                    value={formData.subject}
                    onChange={handleChange}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="contactMessage">Message *</label>
                  <textarea
                    id="contactMessage"
                    name="message"
                    rows={6}
                    required
                    value={formData.message}
                    onChange={handleChange}
                  />
                </div>

                <button type="submit" className="btn btn-primary">
                  Send Message
                </button>
              </form>

              {submitted && (
                <div id="contactSuccess" className="success-message">
                  <h3>Message Sent!</h3>
                  <p>
                    Thank you for contacting us. We&apos;ll get back to you soon.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}