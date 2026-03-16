"use client";

import { FormEvent, useState } from "react";

type ContactFormData = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

const initialFormData: ContactFormData = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

export default function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<ContactFormData>(initialFormData);

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
    setError("");
    setSubmitted(false);
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Failed to send message.");
        setLoading(false);
        return;
      }

      setSubmitted(true);
      setFormData(initialFormData);
    } catch (error) {
      console.error("Error submitting contact form:", error);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="contact-form-wrapper">
      <h2>Send us a Message</h2>

      <form id="contactForm" className="contact-form" onSubmit={handleSubmit}>
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

        {error && <p className="error-message">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Sending..." : "Send Message"}
        </button>
      </form>

      {submitted && (
        <div id="contactSuccess" className="success-message">
          <h3>Message Sent!</h3>
          <p>Thank you for contacting us. We&apos;ll get back to you soon.</p>
        </div>
      )}
    </div>
  );
}
