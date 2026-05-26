"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import AuthPanel from "@/components/auth/AuthPanel";
import {
  AuthInput,
  AuthPasswordInput,
  EmailIcon,
  LockIcon,
  PhoneIcon,
  ShieldIcon,
  SocialAuthButtons,
  UserIcon,
} from "@/components/auth/AuthFormControls";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
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
      title="Join Quest Esports"
      description="Create your gaming account to register teams, manage invites, and stay ready for upcoming events."
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="First Name" htmlFor="firstName" error={form.formState.errors.firstName?.message} required>
            <AuthInput id="firstName" placeholder="Your first name" autoComplete="given-name" icon={<UserIcon />} {...form.register("firstName")} />
          </FormField>
          <FormField label="Last Name" htmlFor="lastName" error={form.formState.errors.lastName?.message} required>
            <AuthInput id="lastName" placeholder="Your last name" autoComplete="family-name" icon={<UserIcon />} {...form.register("lastName")} />
          </FormField>
        </div>

        <FormField label="Email Address" htmlFor="email" error={form.formState.errors.email?.message} required>
          <AuthInput id="email" type="email" placeholder="Enter your email" autoComplete="email" icon={<EmailIcon />} {...form.register("email")} />
        </FormField>

        <FormField label="Username" htmlFor="username" error={form.formState.errors.username?.message} required>
          <AuthInput id="username" placeholder="Choose a username" autoComplete="username" icon={<UserIcon />} {...form.register("username")} />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Password" htmlFor="password" error={form.formState.errors.password?.message} required>
            <AuthPasswordInput
              id="password"
              placeholder="Create a password"
              autoComplete="new-password"
              icon={<LockIcon />}
              {...form.register("password")}
            />
          </FormField>
          <FormField label="Confirm Password" htmlFor="confirmPassword" error={form.formState.errors.confirmPassword?.message} required>
            <AuthPasswordInput
              id="confirmPassword"
              placeholder="Confirm your password"
              autoComplete="new-password"
              icon={<ShieldIcon />}
              {...form.register("confirmPassword")}
            />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Phone Number" htmlFor="phone" hint="Optional">
            <AuthInput id="phone" placeholder="+94 77 123 4567" autoComplete="tel" icon={<PhoneIcon />} {...form.register("phone")} />
          </FormField>
          <FormField label="Discord Tag" htmlFor="discordTag" hint="Optional">
            <AuthInput id="discordTag" placeholder="username#1234" icon={<ShieldIcon />} {...form.register("discordTag")} />
          </FormField>
        </div>

        <label className="flex items-start gap-3 rounded-[16px] border border-slate-800 bg-slate-900/65 px-4 py-3 text-sm text-slate-300">
          <input type="checkbox" className="mt-1 size-4 accent-red-500" {...form.register("terms")} />
          <span>
            I agree to the{" "}
            <Link href="/terms-of-service" className="text-red-300 transition hover:text-red-200">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy" className="text-red-300 transition hover:text-red-200">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {form.formState.errors.terms?.message ? <p className="text-sm text-rose-300">{form.formState.errors.terms.message}</p> : null}
        {form.formState.errors.root?.message ? <p className="text-sm text-rose-300">{form.formState.errors.root.message}</p> : null}

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="h-12 rounded-[16px] border-red-400/30 bg-red-600 shadow-[0_18px_30px_rgba(223,31,31,0.22)] hover:bg-red-500"
        >
          {form.formState.isSubmitting ? "Creating account..." : "Create Account"}
        </Button>

        <SocialAuthButtons mode="signup" />

        <p className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-red-300 transition hover:text-red-200">
            Sign in
          </Link>
        </p>

        {submittedEmail ? (
          <div className="rounded-[20px] border border-emerald-300/20 bg-emerald-400/8 p-5">
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
