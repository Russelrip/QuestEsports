"use client";

import { FormEvent, useState } from "react";
import { useFormFields } from "@/hooks/useFormFields";

type RegistrationFormData = {
  teamName: string;
  captainName: string;
  captainEmail: string;
  captainPhone: string;
  teamSize: string;
  tournament: string;
  teamBio: string;
  terms: boolean;
};

const initialFormData: RegistrationFormData = {
  teamName: "",
  captainName: "",
  captainEmail: "",
  captainPhone: "",
  teamSize: "",
  tournament: "",
  teamBio: "",
  terms: false,
};

export default function RegistrationForm() {
  const [submitted, setSubmitted] = useState(false);
  const { fields: formData, handleFieldChange } =
    useFormFields<RegistrationFormData>(initialFormData);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <section className="registration-section">
      <div className="form-container">
        <h2>Register Your Team</h2>

        <form
          id="registrationForm"
          className="registration-form"
          onSubmit={handleSubmit}
        >
          <div className="form-group">
            <label htmlFor="teamName">Team Name *</label>
            <input
              type="text"
              id="teamName"
              name="teamName"
              required
              value={formData.teamName}
              onChange={handleFieldChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="captainName">Captain Name *</label>
              <input
                type="text"
                id="captainName"
                name="captainName"
                required
                value={formData.captainName}
                onChange={handleFieldChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="captainEmail">Captain Email *</label>
              <input
                type="email"
                id="captainEmail"
                name="captainEmail"
                required
                value={formData.captainEmail}
                onChange={handleFieldChange}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="captainPhone">Captain Phone *</label>
              <input
                type="tel"
                id="captainPhone"
                name="captainPhone"
                required
                value={formData.captainPhone}
                onChange={handleFieldChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="teamSize">Team Size *</label>
              <select
                id="teamSize"
                name="teamSize"
                required
                value={formData.teamSize}
                onChange={handleFieldChange}
              >
                <option value="">Select team size</option>
                <option value="5">5 Players</option>
                <option value="6">6 Players</option>
                <option value="7">7 Players</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="tournament">Tournament *</label>
            <select
              id="tournament"
              name="tournament"
              required
              value={formData.tournament}
              onChange={handleFieldChange}
            >
              <option value="">Select a tournament</option>
              <option value="valorant">Valorant Open Series</option>
              <option value="valorant-women">
                Valorant Women&apos;s Championship
              </option>
              <option value="showdown">Valorant Showdown</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="teamBio">Team Bio</label>
            <textarea
              id="teamBio"
              name="teamBio"
              rows={4}
              placeholder="Tell us about your team..."
              value={formData.teamBio}
              onChange={handleFieldChange}
            />
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                name="terms"
                required
                checked={formData.terms}
                onChange={handleFieldChange}
              />{" "}
              I agree to the terms and conditions *
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            Register Team
          </button>
        </form>

        {submitted && (
          <div id="successMessage" className="success-message">
            <h3>Registration Successful!</h3>
            <p>
              Thank you for registering. You will receive a confirmation email
              shortly.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
