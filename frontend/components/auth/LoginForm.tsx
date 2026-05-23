"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { apiFetchJson, AuthUser, getApiErrorMessage } from "@/lib/auth";

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
        user: AuthUser;
      }>("/api/login", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Login failed.");
      if (errorMessage) {
        form.setError("root", { message: errorMessage });
        return;
      }

      login(data.user);
      form.reset();
      router.push(nextPath || (data.user.role === "admin" ? "/admin" : "/profile"));
    } catch (error) {
      console.error("Login error:", error);
      form.setError("root", { message: "Something went wrong. Please try again." });
    }
  });

  return (
    <AuthPanel
      title="Player Login"
      description="Sign in to manage your roster, registrations, and account status across Quest Esports."
      aside={
        <div className="rounded-[24px] border border-white/8 bg-black/20 p-5 text-sm text-slate-300">
          Returning admins land directly in the control center after sign-in.
        </div>
      }
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <FormField label="Email or Username" htmlFor="emailOrUsername" error={form.formState.errors.emailOrUsername?.message} required>
          <Input id="emailOrUsername" {...form.register("emailOrUsername")} />
        </FormField>

        <FormField label="Password" htmlFor="password" error={form.formState.errors.password?.message} required>
          <Input id="password" type="password" {...form.register("password")} />
        </FormField>

        <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
          <input type="checkbox" className="size-4 accent-cyan-300" {...form.register("remember")} />
          Remember me on this device
        </label>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-rose-300">{form.formState.errors.root.message}</p>
        ) : null}

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Logging in..." : "Login"}
        </Button>

        <div className="flex flex-wrap gap-4 text-sm text-slate-400">
          <Link href="/forgot-password" className="hover:text-white">Forgot password?</Link>
          <Link href="/signup" className="hover:text-white">Create account</Link>
        </div>
      </form>
    </AuthPanel>
  );
}
