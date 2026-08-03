"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, getApiErrorMessage, type AuthUser } from "@/lib/auth";
import { passwordByteLimitMessage, passwordFitsBcrypt } from "@/lib/password";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z.string().min(8, "Password must be at least 8 characters long.").refine(passwordFitsBcrypt, passwordByteLimitMessage),
    confirmNewPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((value) => value.newPassword === value.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Confirm password must match.",
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export default function ChangePasswordForm() {
  const { refreshUser } = useAuth();
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: AuthUser;
      }>("/api/change-password", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Failed to change password.");
      if (errorMessage) {
        form.setError("root", { message: errorMessage });
        return;
      }

      if (data.user) {
        refreshUser(data.user);
      }

      form.reset();
      form.setError("root", {
        message: data.message || "Password updated successfully.",
      });
    } catch (error) {
      console.error("Password change failed:", error);
      form.setError("root", { message: "Something went wrong while changing your password." });
    }
  });

  return (
    <div className="min-w-0 rounded-[24px] border border-white/8 bg-white/5 p-4 sm:p-5">
      <h3 className="text-2xl text-white">Change Password</h3>
      <p className="mt-2 text-sm text-slate-400">
        Other active sessions will be signed out after a successful password change.
      </p>
      <form className="mt-5 grid min-w-0 gap-5" onSubmit={onSubmit}>
        <FormField label="Current Password" htmlFor="currentPassword" error={form.formState.errors.currentPassword?.message} required>
          <Input id="currentPassword" type="password" {...form.register("currentPassword")} />
        </FormField>

        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <FormField label="New Password" htmlFor="newPassword" error={form.formState.errors.newPassword?.message} required>
            <Input id="newPassword" type="password" {...form.register("newPassword")} />
          </FormField>
          <FormField label="Confirm New Password" htmlFor="confirmNewPassword" error={form.formState.errors.confirmNewPassword?.message} required>
            <Input id="confirmNewPassword" type="password" {...form.register("confirmNewPassword")} />
          </FormField>
        </div>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-slate-300">{form.formState.errors.root.message}</p>
        ) : null}

        <Button type="submit" variant="secondary" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Updating..." : "Update Password"}
        </Button>
      </form>
    </div>
  );
}
