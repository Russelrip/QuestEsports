"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, AuthUser, PendingMfaUser, getApiErrorMessage } from "@/lib/auth";

const mfaChallengeSchema = z
  .object({
    code: z.string().optional(),
    backupCode: z.string().optional(),
  })
  .refine((value) => Boolean(value.code?.trim() || value.backupCode?.trim()), {
    message: "Enter an authenticator code or a backup code.",
    path: ["code"],
  });

type MfaChallengeFormValues = z.infer<typeof mfaChallengeSchema>;

type Props = {
  challengeToken: string;
  pendingUser?: PendingMfaUser | null;
  onCancel: () => void;
  onSuccess: (user: AuthUser) => void;
};

export default function MfaChallengeForm({
  challengeToken,
  pendingUser,
  onCancel,
  onSuccess,
}: Props) {
  const form = useForm<MfaChallengeFormValues>({
    resolver: zodResolver(mfaChallengeSchema),
    defaultValues: {
      code: "",
      backupCode: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: AuthUser;
      }>("/api/login/mfa", {
        method: "POST",
        json: {
          challengeToken,
          code: values.code?.trim() || undefined,
          backupCode: values.backupCode?.trim() || undefined,
        },
      });

      const errorMessage = getApiErrorMessage(response, data, "Verification failed.");
      if (errorMessage || !data.user) {
        form.setError("root", { message: errorMessage || "Verification failed." });
        return;
      }

      form.reset();
      onSuccess(data.user);
    } catch (error) {
      console.error("MFA verification failed:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <div className="grid gap-5">
      <div className="rounded-[20px] border border-slate-800 bg-slate-900/65 p-4 text-sm text-slate-300">
        <p className="font-medium text-white">Two-step verification required</p>
        <p className="mt-2">
          Enter the 6-digit code from your authenticator app
          {pendingUser?.email ? ` for ${pendingUser.email}` : ""}, or use one of your backup codes.
        </p>
      </div>

      <form className="grid gap-5" onSubmit={onSubmit}>
        <FormField label="Authenticator Code" htmlFor="mfaCode" error={form.formState.errors.code?.message}>
          <Input
            id="mfaCode"
            inputMode="numeric"
            placeholder="123456"
            autoComplete="one-time-code"
            {...form.register("code")}
          />
        </FormField>

        <FormField label="Backup Code" htmlFor="backupCode" hint="Optional alternative">
          <Input id="backupCode" placeholder="AB12CD34" {...form.register("backupCode")} />
        </FormField>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-rose-300">{form.formState.errors.root.message}</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Verifying..." : "Verify and Sign In"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Back to Login
          </Button>
        </div>
      </form>
    </div>
  );
}
