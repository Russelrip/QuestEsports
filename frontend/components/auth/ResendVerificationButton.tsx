"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

type ResendVerificationButtonProps = {
  email: string;
  className?: string;
  onSent?: (message: string) => void;
};

export default function ResendVerificationButton({
  email,
  className = "",
  onSent,
}: ResendVerificationButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleResend = async () => {
    setIsSubmitting(true);
    setMessage("");
    setError("");

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
      }>("/api/email-verification/resend", {
        method: "POST",
        json: { email },
      });

      const errorMessage = getApiErrorMessage(
        response,
        data,
        "Could not resend verification email."
      );
      if (errorMessage) {
        setError(errorMessage);
        return;
      }

      const nextMessage =
        data.message ||
        "If that account exists and is not yet verified, a new verification email has been sent.";
      setMessage(nextMessage);
      onSent?.(nextMessage);
    } catch (requestError) {
      console.error("Failed to resend verification email:", requestError);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" className={className} disabled={isSubmitting || !email} onClick={handleResend}>
        {isSubmitting ? "Sending..." : "Resend Verification Email"}
      </Button>
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
