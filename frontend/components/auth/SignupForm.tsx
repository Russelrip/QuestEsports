"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useFormFields } from "@/hooks/useFormFields";
import { apiFetch } from "@/lib/auth";

type SignupFormData = {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  phone: string;
  discordTag: string;
  terms: boolean;
};

const initialFormData: SignupFormData = {
  firstName: "",
  lastName: "",
  email: "",
  username: "",
  password: "",
  confirmPassword: "",
  phone: "",
  discordTag: "",
  terms: false,
};

export default function SignupForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const {
    fields: formData,
    handleFieldChange,
    resetFields,
  } = useFormFields<SignupFormData>(initialFormData);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      const res = await apiFetch("/api/signup", {
        method: "POST",
        json: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          username: formData.username,
          password: formData.password,
          phone: formData.phone,
          discordTag: formData.discordTag,
        },
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Signup failed.");
        return;
      }

      setSubmitted(true);
      resetFields();
    } catch (error) {
      console.error("Error submitting signup form:", error);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section className="signup-section">
      <div className="form-container signup-container">
        <div className="signup-box">
          <h2>Player Account Registration</h2>

          <form id="signupForm" className="signup-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="firstName">First Name *</label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  required
                  value={formData.firstName}
                  onChange={handleFieldChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="lastName">Last Name *</label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  required
                  value={formData.lastName}
                  onChange={handleFieldChange}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address *</label>
              <input
                type="email"
                id="email"
                name="email"
                required
                value={formData.email}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="username">Username *</label>
              <input
                type="text"
                id="username"
                name="username"
                required
                value={formData.username}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="password">Password *</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  required
                  value={formData.password}
                  onChange={handleFieldChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  required
                  value={formData.confirmPassword}
                  onChange={handleFieldChange}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="discordTag">Discord Tag</label>
              <input
                type="text"
                id="discordTag"
                name="discordTag"
                placeholder="username#1234"
                value={formData.discordTag}
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
                I agree to the Terms of Service and Privacy Policy *
              </label>
            </div>

            {error && <p className="error-message">{error}</p>}

            <button type="submit" className="btn btn-primary">
              Create Account
            </button>
          </form>

          <p className="form-footer">
            Already have an account? <Link href="/login">Login here</Link>
          </p>

          {submitted && (
            <div id="signupSuccess" className="success-message">
              <h3>Account Created Successfully!</h3>
              <p>
                Welcome to Quest Esports! You can now login, open your profile,
                and join tournaments.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
