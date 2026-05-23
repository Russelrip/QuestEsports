"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { buttonClassName } from "@/components/ui/button";
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
        const { response, data } = await apiFetchJson<{ success?: boolean; message?: string }>(
          `/api/email-change/confirm?token=${encodeURIComponent(token)}`
        );
        const errorMessage = getApiErrorMessage(response, data, "Could not confirm your new email.");
        if (errorMessage) {
          throw new Error(errorMessage);
        }
        if (!cancelled) {
          setStatus("success");
          setMessage(data.message || "Your email address has been updated successfully.");
          await refreshSession();
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Could not confirm your new email.");
        }
      }
    };

    void confirmEmailChange();
    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  return (
    <AuthPanel title="Confirm Email Change" description="We’re applying the email change request to your account now." eyebrow="Identity Update">
      <div className="grid gap-5">
        <div className={`rounded-[24px] p-5 text-sm ${status === "success" ? "border border-emerald-300/20 bg-emerald-400/8 text-slate-100" : "border border-amber-300/20 bg-amber-400/8 text-slate-100"}`}>
          {message}
        </div>
        {status !== "loading" ? (
          <div className="flex flex-wrap gap-3">
            <Link href="/profile" className={buttonClassName({})}>
              Open Profile
            </Link>
            <Link href="/login" className={buttonClassName({ variant: "secondary" })}>
              Go to Login
            </Link>
          </div>
        ) : null}
      </div>
    </AuthPanel>
  );
}
