"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useState } from "react";
import { useFormFields } from "@/hooks/useFormFields";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";

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

type SignupFieldName =
  | "firstName"
  | "lastName"
  | "email"
  | "username"
  | "password"
  | "confirmPassword"
  | "terms";

type SignupFieldErrors = Partial<Record<SignupFieldName, string>>;

type SignupApiResponse = {
  success?: boolean;
  message?: string;
  details?: {
    fieldErrors?: SignupFieldErrors;
  };
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

const validateSignupForm = (formData: SignupFormData): SignupFieldErrors => {
  const fieldErrors: SignupFieldErrors = {};

  if (!formData.firstName.trim()) {
    fieldErrors.firstName = "First name is required.";
  }

  if (!formData.lastName.trim()) {
    fieldErrors.lastName = "Last name is required.";
  }

  if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!formData.username.trim()) {
    fieldErrors.username = "Username is required.";
  }

  if (!formData.password) {
    fieldErrors.password = "Password is required.";
  } else if (formData.password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters long.";
  }

  if (!formData.confirmPassword) {
    fieldErrors.confirmPassword = "Please confirm your password.";
  } else if (formData.password !== formData.confirmPassword) {
    fieldErrors.confirmPassword = "Confirm password must match.";
  }

  if (!formData.terms) {
    fieldErrors.terms = "You must agree to the Terms of Service and Privacy Policy.";
  }

  return fieldErrors;
};

export default function SignupForm() {
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const {
    fields: formData,
    updateField,
    handleFieldChange,
    resetFields,
  } = useFormFields<SignupFormData>(initialFormData);

  const handleSignupFieldChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    handleFieldChange(event);

    const fieldName = event.target.name as SignupFieldName;
    setFieldErrors((currentErrors) => {
      if (!currentErrors[fieldName]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[fieldName];
      return nextErrors;
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitted(false);
    const nextFieldErrors = validateSignupForm(formData);
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    try {
      const { response, data } = await apiFetchJson<SignupApiResponse>("/api/signup", {
        method: "POST",
        json: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          username: formData.username,
          password: formData.password,
          confirmPassword: formData.confirmPassword,
          phone: formData.phone,
          discordTag: formData.discordTag,
          terms: formData.terms,
        },
      });

      const errorMessage = getApiErrorMessage(response, data, "Signup failed.");
      if (errorMessage) {
        const serverFieldErrors = data.details?.fieldErrors ?? {};
        setFieldErrors(serverFieldErrors);
        setError(
          Object.keys(serverFieldErrors).length === 0
            ? errorMessage
            : ""
        );
        return;
      }

      setSubmitted(true);
      setSubmittedEmail(formData.email.trim());
      setFieldErrors({});
      setError("");
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
                  onChange={handleSignupFieldChange}
                  aria-invalid={Boolean(fieldErrors.firstName)}
                />
                {fieldErrors.firstName ? (
                  <p className="field-error">{fieldErrors.firstName}</p>
                ) : null}
              </div>

              <div className="form-group">
                <label htmlFor="lastName">Last Name *</label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  required
                  value={formData.lastName}
                  onChange={handleSignupFieldChange}
                  aria-invalid={Boolean(fieldErrors.lastName)}
                />
                {fieldErrors.lastName ? (
                  <p className="field-error">{fieldErrors.lastName}</p>
                ) : null}
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
                onChange={handleSignupFieldChange}
                aria-invalid={Boolean(fieldErrors.email)}
              />
              {fieldErrors.email ? (
                <p className="field-error">{fieldErrors.email}</p>
              ) : null}
            </div>

            <div className="form-group">
              <label htmlFor="username">Username *</label>
              <input
                type="text"
                id="username"
                name="username"
                required
                value={formData.username}
                onChange={handleSignupFieldChange}
                aria-invalid={Boolean(fieldErrors.username)}
              />
              {fieldErrors.username ? (
                <p className="field-error">{fieldErrors.username}</p>
              ) : null}
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
                  onChange={handleSignupFieldChange}
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                {fieldErrors.password ? (
                  <p className="field-error">{fieldErrors.password}</p>
                ) : null}
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  required
                  value={formData.confirmPassword}
                  onChange={handleSignupFieldChange}
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                />
                {fieldErrors.confirmPassword ? (
                  <p className="field-error">{fieldErrors.confirmPassword}</p>
                ) : null}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleSignupFieldChange}
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
                onChange={handleSignupFieldChange}
              />
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  name="terms"
                  required
                  checked={formData.terms}
                  onChange={(event) => {
                    updateField("terms", event.target.checked);
                    setFieldErrors((currentErrors) => {
                      if (!currentErrors.terms) {
                        return currentErrors;
                      }

                      const nextErrors = { ...currentErrors };
                      delete nextErrors.terms;
                      return nextErrors;
                    });
                  }}
                  aria-invalid={Boolean(fieldErrors.terms)}
                />{" "}
                I agree to the Terms of Service and Privacy Policy *
              </label>
              {fieldErrors.terms ? (
                <p className="field-error">{fieldErrors.terms}</p>
              ) : null}
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
                Check your email to verify your account before registering for tournaments.
              </p>
              <p>
                Used the wrong email? You can still <Link href="/login">log in</Link> and
                change it from your profile before verifying.
              </p>
              <ResendVerificationButton email={submittedEmail} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
