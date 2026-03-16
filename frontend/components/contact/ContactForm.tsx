"use client";

import { FormEvent, useState } from "react";
import { useFormFields } from "@/hooks/useFormFields";
import { apiFetch } from "@/lib/auth";

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
  const {
    fields: formData,
    handleFieldChange,
    resetFields,
  } = useFormFields<ContactFormData>(initialFormData);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);
    setLoading(true);

    try {
      const res = await apiFetch("/api/contact", {
        method: "POST",
        json: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Failed to send message.");
        setLoading(false);
        return;
      }

      setSubmitted(true);
      resetFields();
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
            onChange={handleFieldChange}
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
            onChange={handleFieldChange}
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
            onChange={handleFieldChange}
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
            onChange={handleFieldChange}
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
