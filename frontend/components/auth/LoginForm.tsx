"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import AuthPanel from "@/components/auth/AuthPanel";
import MfaChallengeForm from "@/components/auth/MfaChallengeForm";
import {
  AuthInput,
  AuthPasswordInput,
  LockIcon,
  SocialAuthButtons,
  UserIcon,
} from "@/components/auth/AuthFormControls";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { apiFetchJson, AuthUser, PendingMfaUser, getApiErrorMessage } from "@/lib/auth";

const loginSchema = z.object({
  emailOrUsername: z.string().min(1, "Please enter your username or email."),
  password: z.string().min(1, "Please enter your password."),
  remember: z.boolean(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [pendingMfaUser, setPendingMfaUser] = useState<PendingMfaUser | null>(null);
  const redirectTo = searchParams.get("redirect");
  const nextPath = redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : null;

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      emailOrUsername: "",
      password: "",
      remember: false,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: AuthUser | PendingMfaUser;
        requiresMfa?: boolean;
        challengeToken?: string;
      }>("/api/login", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Login failed.");
      if (errorMessage) {
        form.setError("root", { message: errorMessage });
        return;
      }

      if (data.requiresMfa && data.challengeToken) {
        setMfaChallengeToken(data.challengeToken);
        setPendingMfaUser((data.user as PendingMfaUser) || null);
        form.setError("root", { message: data.message || "Verification code required." });
        return;
      }

      if (!data.user) {
        form.setError("root", { message: "Login failed." });
        return;
      }

      login(data.user as AuthUser);
      form.reset();
      router.push(nextPath || ((data.user as AuthUser).role === "admin" ? "/admin" : "/profile"));
    } catch (error) {
      console.error("Login error:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <AuthPanel
      title="Welcome Back"
      description="Sign in to manage your roster, registrations, and tournament profile."
    >
      {mfaChallengeToken ? (
        <MfaChallengeForm
          challengeToken={mfaChallengeToken}
          pendingUser={pendingMfaUser}
          onCancel={() => {
            setMfaChallengeToken("");
            setPendingMfaUser(null);
          }}
          onSuccess={(user) => {
            login(user);
            form.reset();
            setMfaChallengeToken("");
            setPendingMfaUser(null);
            router.push(nextPath || (user.role === "admin" ? "/admin" : "/profile"));
          }}
        />
      ) : (
      <form className="grid gap-5" onSubmit={onSubmit}>
        <FormField label="Email or Username" htmlFor="emailOrUsername" error={form.formState.errors.emailOrUsername?.message} required>
          <AuthInput
            id="emailOrUsername"
            placeholder="Enter your email or username"
            autoComplete="username"
            icon={<UserIcon />}
            {...form.register("emailOrUsername")}
          />
        </FormField>

        <FormField label="Password" htmlFor="password" error={form.formState.errors.password?.message} required>
          <AuthPasswordInput
            id="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            icon={<LockIcon />}
            {...form.register("password")}
          />
        </FormField>

        <label className="flex items-center gap-3 rounded-[16px] border border-slate-800 bg-slate-900/65 px-4 py-3 text-sm text-slate-300">
          <input type="checkbox" className="size-4 accent-red-500" {...form.register("remember")} />
          Remember me on this device
        </label>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-rose-300">{form.formState.errors.root.message}</p>
        ) : null}

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="h-12 rounded-[16px] border-red-400/30 bg-red-600 shadow-[0_18px_30px_rgba(223,31,31,0.22)] hover:bg-red-500"
        >
          {form.formState.isSubmitting ? "Logging in..." : "Sign In"}
        </Button>

        <SocialAuthButtons mode="login" redirectTo={nextPath} />

        <div className="flex flex-wrap justify-between gap-4 text-sm text-slate-400">
          <Link href="/forgot-password" className="transition hover:text-white">Forgot password?</Link>
          <span>
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-red-300 transition hover:text-red-200">
              Sign up
            </Link>
          </span>
        </div>
      </form>
      )}
    </AuthPanel>
  );
}
