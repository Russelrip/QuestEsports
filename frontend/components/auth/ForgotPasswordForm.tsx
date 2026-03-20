"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useFormFields } from "@/hooks/useFormFields";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

type ForgotPasswordFields = {
  email: string;
};

const initialFields: ForgotPasswordFields = {
  email: "",
};

export default function ForgotPasswordForm() {
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const { fields, handleFieldChange, resetFields } =
    useFormFields<ForgotPasswordFields>(initialFields);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage("");
    setError("");

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
      }>("/api/forgot-password", {
        method: "POST",
        json: { email: fields.email },
      });

      const errorMessage = getApiErrorMessage(
        response,
        data,
        "Could not submit your request."
      );
      if (errorMessage) {
        setError(errorMessage);
        return;
      }

      setSuccessMessage(
        data.message ||
          "If that email is registered, you will receive password reset instructions shortly."
      );
      resetFields();
    } catch (requestError) {
      console.error("Forgot password request failed:", requestError);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section className="login-section">
      <div className="form-container login-container">
        <div className="login-box">
          <h2>Forgot Password</h2>
          <p className="section-intro">
            Enter your email address and we&apos;ll send you a reset link if an account exists.
          </p>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email Address *</label>
              <input
                id="email"
                name="email"
                type="email"
                value={fields.email}
                onChange={handleFieldChange}
                required
              />
            </div>

            {successMessage ? <p className="success-inline">{successMessage}</p> : null}
            {error ? <p className="error-message">{error}</p> : null}

            <button type="submit" className="btn btn-primary">
              Send Reset Link
            </button>
          </form>

          <p className="form-footer">
            <Link href="/login">Back to Login</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
