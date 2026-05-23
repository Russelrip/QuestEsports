"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import AuthPanel from "@/components/auth/AuthPanel";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

const signupSchema = z
  .object({
    firstName: z.string().min(1, "First name is required."),
    lastName: z.string().min(1, "Last name is required."),
    email: z.string().email("Please enter a valid email address."),
    username: z.string().min(1, "Username is required."),
    password: z.string().min(8, "Password must be at least 8 characters long."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
    phone: z.string().optional(),
    discordTag: z.string().optional(),
    terms: z.boolean().refine((value) => value, {
      message: "You must agree before continuing.",
    }),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Confirm password must match.",
  });

type SignupFormValues = z.infer<typeof signupSchema>;

type SignupApiResponse = {
  success?: boolean;
  message?: string;
  details?: {
    fieldErrors?: Partial<Record<"firstName" | "lastName" | "email" | "username" | "password" | "confirmPassword" | "terms", string>>;
  };
};

export default function SignupForm() {
  const [submittedEmail, setSubmittedEmail] = useState("");
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
      phone: "",
      discordTag: "",
      terms: true,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<SignupApiResponse>("/api/signup", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Signup failed.");
      if (errorMessage) {
        const fieldErrors = data.details?.fieldErrors ?? {};
        for (const [key, value] of Object.entries(fieldErrors)) {
          form.setError(key as keyof SignupFormValues, { message: value });
        }
        if (Object.keys(fieldErrors).length === 0) {
          form.setError("root", { message: errorMessage });
        }
        return;
      }

      setSubmittedEmail(values.email);
      form.reset({
        firstName: "",
        lastName: "",
        email: "",
        username: "",
        password: "",
        confirmPassword: "",
        phone: "",
        discordTag: "",
        terms: true,
      });
    } catch (error) {
      console.error("Error submitting signup form:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <AuthPanel
      title="Create Player Account"
      description="Set up your Quest Esports identity so you can register teams, confirm invites, and receive tournament updates."
      eyebrow="Player Onboarding"
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="First Name" htmlFor="firstName" error={form.formState.errors.firstName?.message} required>
            <Input id="firstName" {...form.register("firstName")} />
          </FormField>
          <FormField label="Last Name" htmlFor="lastName" error={form.formState.errors.lastName?.message} required>
            <Input id="lastName" {...form.register("lastName")} />
          </FormField>
        </div>

        <FormField label="Email Address" htmlFor="email" error={form.formState.errors.email?.message} required>
          <Input id="email" type="email" {...form.register("email")} />
        </FormField>

        <FormField label="Username" htmlFor="username" error={form.formState.errors.username?.message} required>
          <Input id="username" {...form.register("username")} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Password" htmlFor="password" error={form.formState.errors.password?.message} required>
            <Input id="password" type="password" {...form.register("password")} />
          </FormField>
          <FormField label="Confirm Password" htmlFor="confirmPassword" error={form.formState.errors.confirmPassword?.message} required>
            <Input id="confirmPassword" type="password" {...form.register("confirmPassword")} />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Phone Number" htmlFor="phone" hint="Optional">
            <Input id="phone" {...form.register("phone")} />
          </FormField>
          <FormField label="Discord Tag" htmlFor="discordTag" hint="Optional">
            <Input id="discordTag" placeholder="username#1234" {...form.register("discordTag")} />
          </FormField>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
          <input type="checkbox" className="mt-1 size-4 accent-cyan-300" {...form.register("terms")} />
          <span>I agree to the Terms of Service and Privacy Policy.</span>
        </label>
        {form.formState.errors.terms?.message ? <p className="text-sm text-rose-300">{form.formState.errors.terms.message}</p> : null}
        {form.formState.errors.root?.message ? <p className="text-sm text-rose-300">{form.formState.errors.root.message}</p> : null}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Creating account..." : "Create Account"}
        </Button>

        <p className="text-sm text-slate-400">
          Already have an account? <Link href="/login" className="text-white">Login here</Link>
        </p>

        {submittedEmail ? (
          <div className="rounded-[24px] border border-emerald-300/20 bg-emerald-400/8 p-5">
            <h3 className="text-lg font-semibold text-white">Account created successfully</h3>
            <p className="mt-2 text-sm text-slate-300">
              Check your inbox to verify your email before joining a tournament.
            </p>
            <div className="mt-4">
              <ResendVerificationButton email={submittedEmail} />
            </div>
          </div>
        ) : null}
      </form>
    </AuthPanel>
  );
}
