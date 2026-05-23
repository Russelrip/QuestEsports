"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { buttonClassName } from "@/components/ui/button";
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
        const { response, data } = await apiFetchJson<{ success?: boolean; message?: string }>(
          `/api/email-verification/verify?token=${encodeURIComponent(token)}`
        );

        const errorMessage = getApiErrorMessage(response, data, "Could not verify your email.");
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        if (!cancelled) {
          setStatus("success");
          setMessage(data.message || "Your email has been verified successfully.");
          await refreshSession();
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Could not verify your email.");
        }
      }
    };

    void verifyEmail();
    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  return (
    <AuthPanel title="Verify Email" description="We’re confirming your account so you can register for events and manage your team." eyebrow="Email Verification">
      <div className="grid gap-5">
        <div className={`rounded-[24px] p-5 text-sm ${status === "success" ? "border border-emerald-300/20 bg-emerald-400/8 text-slate-100" : "border border-amber-300/20 bg-amber-400/8 text-slate-100"}`}>
          {message}
        </div>

        {status === "success" ? (
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className={buttonClassName({})}>
              Continue to Login
            </Link>
            <Link href="/profile" className={buttonClassName({ variant: "secondary" })}>
              Open Profile
            </Link>
          </div>
        ) : status === "error" ? (
          <div className="flex flex-wrap gap-3">
            {user?.email && !user.emailVerified ? <ResendVerificationButton email={user.email} /> : null}
            <Link href="/login" className={buttonClassName({ variant: "secondary" })}>
              Go to Login
            </Link>
          </div>
        ) : null}
      </div>
    </AuthPanel>
  );
}
