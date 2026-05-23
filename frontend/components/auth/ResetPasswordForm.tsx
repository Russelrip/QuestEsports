"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import AuthPanel from "@/components/auth/AuthPanel";
import { Button, buttonClassName } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters long."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Confirm password must match.",
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) {
      form.setError("root", { message: "Reset token is missing." });
      return;
    }

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
      }>("/api/reset-password", {
        method: "POST",
        json: {
          token,
          newPassword: values.newPassword,
        },
      });

      const errorMessage = getApiErrorMessage(response, data, "Could not reset your password.");
      if (errorMessage) {
        form.setError("root", { message: errorMessage });
        return;
      }

      form.reset();
      window.setTimeout(() => {
        router.push("/login");
      }, 1200);
      form.setError("root", {
        message: data.message || "Your password has been reset successfully. Redirecting to login...",
      });
    } catch (error) {
      console.error("Reset password request failed:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <AuthPanel
      title="Reset Password"
      description="Choose a new password to regain access to your Quest Esports account."
      eyebrow="Secure Reset"
    >
      {!token ? (
        <div className="rounded-[24px] border border-amber-300/20 bg-amber-400/8 p-5">
          <p className="text-sm text-slate-200">This reset link is missing its token. Request a fresh password reset email.</p>
          <div className="mt-4">
            <Link href="/forgot-password" className={buttonClassName({ variant: "secondary" })}>
              Request New Link
            </Link>
          </div>
        </div>
      ) : (
        <form className="grid gap-5" onSubmit={onSubmit}>
          <FormField label="New Password" htmlFor="newPassword" error={form.formState.errors.newPassword?.message} required>
            <Input id="newPassword" type="password" {...form.register("newPassword")} />
          </FormField>
          <FormField label="Confirm Password" htmlFor="confirmPassword" error={form.formState.errors.confirmPassword?.message} required>
            <Input id="confirmPassword" type="password" {...form.register("confirmPassword")} />
          </FormField>
          {form.formState.errors.root?.message ? <p className="text-sm text-slate-300">{form.formState.errors.root.message}</p> : null}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Resetting..." : "Reset Password"}
          </Button>
        </form>
      )}
    </AuthPanel>
  );
}
