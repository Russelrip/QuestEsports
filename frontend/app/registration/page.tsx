"use client";

import { FormEvent, useState } from "react";

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

export default function RegistrationPage() {
  const [submitted, setSubmitted] = useState(false);

  const [formData, setFormData] = useState<RegistrationFormData>({
    teamName: "",
    captainName: "",
    captainEmail: "",
    captainPhone: "",
    teamSize: "",
    tournament: "",
    teamBio: "",
    terms: false,
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === "checkbox") {
      setFormData((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    console.log("Registration submitted:", formData);
    setSubmitted(true);
  };

  return (
    <>
      <section className="page-header">
        <h1>Team Registration</h1>
        <p>Join Quest Esports tournaments</p>
      </section>

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
                onChange={handleChange}
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
                  onChange={handleChange}
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
                  onChange={handleChange}
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
                  onChange={handleChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="teamSize">Team Size *</label>
                <select
                  id="teamSize"
                  name="teamSize"
                  required
                  value={formData.teamSize}
                  onChange={handleChange}
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
                onChange={handleChange}
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
                onChange={handleChange}
              />
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  name="terms"
                  required
                  checked={formData.terms}
                  onChange={handleChange}
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
    </>
  );
}