"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

export default function ConfirmEmailChangeContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const { refreshSession } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Confirming your new email...");

  useEffect(() => {
    let cancelled = false;

    const confirmEmailChange = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Email change token is missing.");
        return;
      }

      try {
        const { response, data } = await apiFetchJson<{
          success?: boolean;
          message?: string;
        }>(`/api/email-change/confirm?token=${encodeURIComponent(token)}`);

        const errorMessage = getApiErrorMessage(
          response,
          data,
          "Could not confirm your new email."
        );

        if (errorMessage) {
          throw new Error(errorMessage);
        }

        if (cancelled) {
          return;
        }

        setStatus("success");
        setMessage(data.message || "Your email address has been updated successfully.");
        await refreshSession();
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setMessage(
          requestError instanceof Error
            ? requestError.message
            : "Could not confirm your new email."
        );
      }
    };

    void confirmEmailChange();

    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  return (
    <section className="login-section">
      <div className="form-container login-container">
        <div className="login-box">
          <h2>Confirm Email Change</h2>

          <div
            className={`auth-callout ${
              status === "success" ? "auth-callout-success" : "auth-callout-warning"
            }`}
          >
            <p>{message}</p>
          </div>

          {status === "loading" ? null : (
            <div className="auth-inline-actions">
              <Link href="/profile" className="btn btn-primary btn-small">
                Open Profile
              </Link>
              <Link href="/login" className="btn btn-secondary btn-small">
                Go to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
