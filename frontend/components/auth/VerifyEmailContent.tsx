"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

export default function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const { user, refreshSession } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    let cancelled = false;

    const verifyEmail = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Verification token is missing.");
        return;
      }

      try {
        const { response, data } = await apiFetchJson<{
          success?: boolean;
          message?: string;
        }>(
          `/api/email-verification/verify?token=${encodeURIComponent(token)}`
        );
        const errorMessage = getApiErrorMessage(
          response,
          data,
          "Could not verify your email."
        );
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        if (cancelled) {
          return;
        }

        setStatus("success");
        setMessage(data.message || "Your email has been verified successfully.");
        await refreshSession();
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setMessage(
          requestError instanceof Error
            ? requestError.message
            : "Could not verify your email."
        );
      }
    };

    void verifyEmail();

    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  return (
    <section className="login-section">
      <div className="form-container login-container">
        <div className="login-box">
          <h2>Verify Email</h2>

          <div
            className={`auth-callout ${
              status === "success" ? "auth-callout-success" : "auth-callout-warning"
            }`}
          >
            <p>{message}</p>
          </div>

          {status === "loading" ? null : status === "success" ? (
            <div className="auth-inline-actions">
              <Link href="/login" className="btn btn-primary btn-small">
                Continue to Login
              </Link>
              <Link href="/profile" className="btn btn-secondary btn-small">
                Open Profile
              </Link>
            </div>
          ) : (
            <div className="auth-inline-actions">
              {user?.email && !user.emailVerified ? (
                <ResendVerificationButton email={user.email} />
              ) : (
                <Link href="/signup" className="btn btn-secondary btn-small">
                  Create Account
                </Link>
              )}
              <Link href="/login" className="btn btn-primary btn-small">
                Go to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
