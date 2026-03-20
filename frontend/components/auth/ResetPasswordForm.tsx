"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormFields } from "@/hooks/useFormFields";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

type ResetPasswordFields = {
  newPassword: string;
  confirmPassword: string;
};

const initialFields: ResetPasswordFields = {
  newPassword: "",
  confirmPassword: "",
};

export default function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { fields, handleFieldChange, resetFields } =
    useFormFields<ResetPasswordFields>(initialFields);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage("");
    setError("");

    if (!token) {
      setError("Reset token is missing.");
      return;
    }

    if (fields.newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (fields.newPassword !== fields.confirmPassword) {
      setError("Confirm password must match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
      }>("/api/reset-password", {
        method: "POST",
        json: {
          token,
          newPassword: fields.newPassword,
        },
      });

      const errorMessage = getApiErrorMessage(
        response,
        data,
        "Could not reset your password."
      );
      if (errorMessage) {
        setError(errorMessage);
        return;
      }

      setSuccessMessage(
        data.message || "Your password has been reset successfully. Please sign in again."
      );
      resetFields();
      window.setTimeout(() => {
        router.push("/login");
      }, 1200);
    } catch (requestError) {
      console.error("Reset password request failed:", requestError);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="login-section">
      <div className="form-container login-container">
        <div className="login-box">
          <h2>Reset Password</h2>
          <p className="section-intro">
            Choose a new password for your Quest Esports account.
          </p>

          {!token ? (
            <div className="auth-callout auth-callout-warning">
              <p>This reset link is missing its token. Request a fresh password reset email.</p>
              <Link href="/forgot-password" className="btn btn-secondary btn-small">
                Request New Link
              </Link>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="newPassword">New Password *</label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  value={fields.newPassword}
                  onChange={handleFieldChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  value={fields.confirmPassword}
                  onChange={handleFieldChange}
                  required
                />
              </div>

              {successMessage ? <p className="success-inline">{successMessage}</p> : null}
              {error ? <p className="error-message">{error}</p> : null}

              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          )}

          <p className="form-footer">
            <Link href="/login">Back to Login</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
