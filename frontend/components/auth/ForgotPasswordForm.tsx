"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import AuthPanel from "@/components/auth/AuthPanel";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordForm() {
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
      }>("/api/forgot-password", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Could not submit your request.");
      if (errorMessage) {
        form.setError("root", { message: errorMessage });
        return;
      }

      form.reset();
      form.setError("root", {
        message:
          data.message || "If that email is registered, you will receive password reset instructions shortly.",
      });
    } catch (error) {
      console.error("Forgot password request failed:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <AuthPanel
      title="Forgot Password"
      description="Request a secure reset link. If the address exists in our system, we’ll send instructions right away."
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <FormField label="Email Address" htmlFor="email" error={form.formState.errors.email?.message} required>
          <Input id="email" type="email" {...form.register("email")} />
        </FormField>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-slate-300">{form.formState.errors.root.message}</p>
        ) : null}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Sending..." : "Send Reset Link"}
        </Button>

        <p className="text-sm text-slate-400">
          <Link href="/login" className="text-white">Back to login</Link>
        </p>
      </form>
    </AuthPanel>
  );
}
