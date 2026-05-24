"use client";

import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const authInputClassName =
  "h-13 rounded-[16px] border border-slate-700/90 bg-[#11162a] pl-12 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-red-400/60 focus:bg-[#151a31] focus:ring-4 focus:ring-red-500/10";

type AuthInputProps = React.ComponentProps<typeof Input> & {
  icon: React.ReactNode;
  trailing?: React.ReactNode;
};

export function AuthInput({ icon, trailing, className, ...props }: AuthInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-500">{icon}</span>
      <Input className={cn(authInputClassName, trailing ? "pr-12" : "", className)} {...props} />
      {trailing ? <span className="absolute inset-y-0 right-0 flex items-center pr-4">{trailing}</span> : null}
    </div>
  );
}

export function AuthPasswordInput(props: Omit<AuthInputProps, "type" | "trailing">) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <AuthInput
      {...props}
      type={isVisible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          className="cursor-pointer text-slate-500 transition hover:text-slate-300"
          aria-label={isVisible ? "Hide password" : "Show password"}
        >
          {isVisible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}

type SocialAuthButtonsProps = {
  mode: "login" | "signup";
  redirectTo?: string | null;
};

export function SocialAuthButtons({ mode, redirectTo }: SocialAuthButtonsProps) {
  const [message, setMessage] = useState("");

  const providers = [
    {
      id: "google",
      label: mode === "signup" ? "Sign up with Google" : "Continue with Google",
      href: buildSocialUrl(
        process.env.NEXT_PUBLIC_GOOGLE_AUTH_PATH || "/api/auth/google/start",
        redirectTo
      ),
      icon: <GoogleIcon />,
    },
    {
      id: "discord",
      label: mode === "signup" ? "Sign up with Discord" : "Continue with Discord",
      href: buildSocialUrl(
        process.env.NEXT_PUBLIC_DISCORD_AUTH_PATH || "/api/auth/discord/start",
        redirectTo
      ),
      icon: <DiscordIcon />,
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="relative py-1 text-center text-xs text-slate-500">
        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-slate-800" />
        <span className="relative bg-[#0a0f1f] px-3">
          {mode === "signup" ? "or sign up with" : "or continue with"}
        </span>
      </div>

      {providers.map((provider) =>
        provider.href ? (
          <Link
            key={provider.id}
            href={provider.href}
            className={cn(
              "flex h-12 items-center justify-center gap-3 rounded-[16px] border text-sm font-semibold text-white transition",
              provider.id === "discord"
                ? "border-indigo-400/30 bg-indigo-500/16 hover:bg-indigo-500/22"
                : "border-slate-700 bg-slate-800/80 hover:bg-slate-700/80"
            )}
          >
            {provider.icon}
            <span>{provider.label}</span>
          </Link>
        ) : (
          <button
            key={provider.id}
            type="button"
            onClick={() => setMessage(`${provider.id === "google" ? "Google" : "Discord"} ${mode} is not configured yet.`)}
            className={cn(
              "flex h-12 items-center justify-center gap-3 rounded-[16px] border text-sm font-semibold text-white transition",
              provider.id === "discord"
                ? "border-indigo-400/30 bg-indigo-500/16 hover:bg-indigo-500/22"
                : "border-slate-700 bg-slate-800/80 hover:bg-slate-700/80"
            )}
          >
            {provider.icon}
            <span>{provider.label}</span>
          </button>
        )
      )}

      {message ? <p className="text-center text-xs text-amber-300">{message}</p> : null}
    </div>
  );
}

function buildSocialUrl(path: string | undefined, redirectTo?: string | null) {
  if (!path) {
    return "";
  }

  const normalizedPath = path.startsWith("http")
    ? path
    : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${path.startsWith("/") ? path : `/${path}`}`;

  if (!redirectTo) {
    return normalizedPath;
  }

  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${normalizedPath}${separator}redirect=${encodeURIComponent(redirectTo)}`;
}

export function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function EmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.75" y="5.75" width="16.5" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5.5 8 6.5 5 6.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.2 4.75h2.1c.42 0 .79.28.91.68l.83 2.78a1 1 0 0 1-.25.99l-1.4 1.4a14.4 14.4 0 0 0 4.02 4.02l1.4-1.4a1 1 0 0 1 .99-.25l2.78.83c.4.12.68.49.68.91v2.1c0 .55-.45 1-1 1h-1.2C10.81 18.81 5.19 13.19 5.19 6.95v-1.2c0-.55.45-1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.75" y="10.75" width="14.5" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 10.75V8a4 4 0 1 1 8 0v2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.75c2.39 1.92 4.95 2.89 7.69 2.89v4.73c0 4.06-2.39 7.36-7.19 9.88-4.8-2.52-7.19-5.82-7.19-9.88V6.64c2.74 0 5.3-.97 7.69-2.89Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m9.5 12.25 1.75 1.75 3.25-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DiscordBadgeIcon() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#ff4d4d,#da1f1f)] shadow-[0_16px_32px_rgba(255,59,59,0.28)]">
      <UserPlusIcon />
    </div>
  );
}

function UserPlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-white">
      <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 18a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 8v6M14 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.75 12s3.25-5.75 9.25-5.75S21.25 12 21.25 12 18 17.75 12 17.75 2.75 12 2.75 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4 20 20M10.58 6.3A9.28 9.28 0 0 1 12 6.2c6 0 9.25 5.8 9.25 5.8a16.8 16.8 0 0 1-3.02 3.72M14.12 14.3A3 3 0 0 1 9.7 9.88M6.35 8.34A16.06 16.06 0 0 0 2.75 12s3.25 5.75 9.25 5.75c1.08 0 2.08-.18 3-.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.8 12.23c0-.68-.06-1.33-.18-1.95H12v3.7h5.5a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.04-4.4 3.04-7.39Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.08-.92 6.77-2.49l-3.3-2.56c-.92.62-2.1.98-3.47.98-2.67 0-4.93-1.8-5.73-4.22H2.86v2.64A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.27 13.71A6 6 0 0 1 5.95 12c0-.59.11-1.16.32-1.71V7.65H2.86A10 10 0 0 0 2 12c0 1.57.37 3.05 1.03 4.35l3.24-2.64Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.07c1.5 0 2.84.52 3.89 1.55l2.92-2.92C17.07 3.07 14.75 2 12 2A10 10 0 0 0 2.86 7.65l3.41 2.64c.8-2.42 3.06-4.22 5.73-4.22Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18.94 6.6a15.9 15.9 0 0 0-3.99-1.25l-.19.39a14.7 14.7 0 0 1 3.56 1.23 11.68 11.68 0 0 0-3.53-1.12 14.4 14.4 0 0 0-5.58 0A11.45 11.45 0 0 0 5.7 6.97a14.2 14.2 0 0 1 3.55-1.23l-.18-.39A15.78 15.78 0 0 0 5.08 6.6C2.53 10.44 1.83 14.18 2.18 17.86a15.98 15.98 0 0 0 4.9 2.49l1.05-1.72c-.57-.22-1.12-.49-1.64-.8.14.1.28.2.43.3 2.87 1.96 5.99 1.96 8.83 0 .14-.1.28-.2.43-.3-.52.31-1.07.58-1.64.8l1.05 1.72a15.88 15.88 0 0 0 4.9-2.49c.41-4.26-.7-7.97-2.55-11.26ZM9.55 15.61c-.95 0-1.73-.88-1.73-1.96s.76-1.96 1.73-1.96c.96 0 1.74.88 1.73 1.96 0 1.08-.77 1.96-1.73 1.96Zm4.9 0c-.96 0-1.73-.88-1.73-1.96s.77-1.96 1.73-1.96c.96 0 1.73.88 1.73 1.96s-.77 1.96-1.73 1.96Z"
        fill="currentColor"
      />
    </svg>
  );
}
