"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { getProviderLinkUrl } from "@/lib/account-linking";
import type {
  ValorantRegistrationPreview,
} from "@/lib/valorant";
import {
  checkPuuidRegistered,
  previewValorantRegistration,
  submitValorantRegistration,
} from "@/lib/valorant-api";

const STEPS = ["Discord", "PUUID", "Confirm"];

const EXAMPLE_PUUID_JSON = `{
  "sub": "a91c72de-849a-4c2b-9e83-b45a8b3fdfe1",
  "email": "alex.rivera99@example.net",
  "username": "CyberFalcon77",
  "alias": {
    "game_name": "NovaStrike",
    "tag_line": "Z9X"
  },
  ...
}`;

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const DetailRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <dt className="text-sm text-slate-400">{label}</dt>
    <dd className="text-sm font-medium text-slate-100">{value}</dd>
  </div>
);

const formatLastPlayed = (dateString: string | null): string => {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "N/A";
  }
};

const getRankColor = (rank: string): string => {
  const rankLower = rank.toLowerCase();
  if (rankLower.includes("iron")) return "#4a4a4a";
  if (rankLower.includes("bronze")) return "#cd7f32";
  if (rankLower.includes("silver")) return "#c0c0c0";
  if (rankLower.includes("gold")) return "#ffd700";
  if (rankLower.includes("platinum")) return "#00ffff";
  if (rankLower.includes("diamond")) return "#b566d9";
  if (rankLower.includes("ascendant")) return "#32cd32";
  if (rankLower.includes("immortal")) return "#ff6b6b";
  if (rankLower.includes("radiant")) return "#ffffff";
  return "#9aa0a6";
};

const messageForRegistrationError = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback;
  const status = "status" in error ? (error as { status?: number }).status : undefined;
  if (status === 409) {
    return "This account is already registered. Each player can only register once. If you need to update your registration, please contact an administrator.";
  }
  if (status === 404) {
    return "Player not found. Please check your PUUID and try again.";
  }
  return error.message || fallback;
};

export default function ValorantRegistration() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [step, setStep] = useState(0);
  const discordId = user?.discordId?.trim() || null;
  const discordUser = useMemo(() => discordId
    ? { discord_username: user?.discordTag || "Discord user" }
    : null, [discordId, user?.discordTag]);
  const [puuid, setPuuid] = useState("");
  const [preview, setPreview] = useState<ValorantRegistrationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const discordIdRef = useRef<string | null>(discordId);
  const previewDiscordIdRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  discordIdRef.current = discordId;

  // Clear the pending redirect timer if the component unmounts.
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!discordId) {
      requestRef.current += 1;
      previewDiscordIdRef.current = null;
      setPreview(null);
      setStep(0);
      setSuccess(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (step === 0) setStep(1);
  }, [discordId, step]);

  useEffect(() => {
    if (success) successHeadingRef.current?.focus();
  }, [success]);

  const handleDiscordLogin = () => window.location.assign(getProviderLinkUrl("discord"));

  const handlePuuidSubmit = async () => {
    const linkedDiscordId = discordIdRef.current;
    const value = puuid.trim();
    if (!linkedDiscordId) return;
    if (!value) {
      setError("Please enter your PUUID");
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const check = await checkPuuidRegistered(value);
      if (requestId !== requestRef.current || discordIdRef.current !== linkedDiscordId) return;
      if (check.exists && check.user) {
        setError(
          `This PUUID is already registered to ${check.user.name}#${check.user.tag}. Each player can only register once. If this is your account and you need to update your Discord connection, please contact an administrator.`,
        );
        return;
      }
      const playerPreview = await previewValorantRegistration(value);
      if (requestId !== requestRef.current || discordIdRef.current !== linkedDiscordId) return;
      previewDiscordIdRef.current = linkedDiscordId;
      setPreview(playerPreview);
      setStep(2);
    } catch (previewError) {
      if (requestId !== requestRef.current || discordIdRef.current !== linkedDiscordId) return;
      setError(messageForRegistrationError(previewError, "Failed to fetch player data. Please try again later."));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  const handleDifferentPuuid = () => {
    previewDiscordIdRef.current = null;
    setPreview(null);
    setPuuid("");
    setStep(1);
    setError(null);
  };

  if (authLoading) {
    return <div role="status" aria-live="polite"><Container className="py-10 sm:py-14"><LoadingState title="Loading registration" description="Checking your Quest account and connected Discord." /></Container></div>;
  }

  if (!user) {
    return <Container className="py-10 sm:py-14"><Card className="mx-auto max-w-xl p-8 text-center"><h2 className="text-xl font-semibold text-white">Sign in to register</h2><p className="mt-2 text-sm text-slate-400">A Quest account is required before you can add a player to the leaderboard.</p><Link href="/login?redirect=%2Fvalorant-leaderboard%2Fregister" className={buttonClassName({ variant: "primary", size: "lg" })}>Sign in to continue</Link></Card></Container>;
  }

  const handleFinalSubmit = async () => {
    const linkedDiscordId = discordIdRef.current;
    if (!user || !linkedDiscordId || !preview || previewDiscordIdRef.current !== linkedDiscordId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      await submitValorantRegistration({
        puuid: preview.puuid,
      });
      if (requestId !== requestRef.current || discordIdRef.current !== linkedDiscordId) return;
      setSuccess(true);
      redirectTimerRef.current = setTimeout(() => {
        router.push("/valorant-leaderboard");
      }, 3000);
    } catch (submitError) {
      if (requestId !== requestRef.current || discordIdRef.current !== linkedDiscordId) return;
      setError(messageForRegistrationError(submitError, "Registration failed. Please try again."));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  if (success) {
    return (
      <Container className="py-10 sm:py-14">
        <div className="mx-auto w-full max-w-xl">
          <Card className="p-10 text-center" role="status" aria-live="polite">
            <svg
              viewBox="0 0 24 24"
              className="mx-auto mb-5 size-14 text-emerald-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <h2 ref={successHeadingRef} tabIndex={-1} className="text-2xl font-semibold text-white">Registration Successful!</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-slate-400">
              Welcome to the Quest E-sports Valorant leaderboard — you&apos;ve been added.
            </p>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Redirecting to leaderboard...
            </p>
          </Card>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-center">
          {STEPS.map((label, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <div key={label} className="flex items-center">
                {index > 0 && (
                  <span className={cn("mx-3 h-px w-8", done || active ? "bg-purple-300/40" : "bg-white/10")} />
                )}
                <div className={cn("flex items-center gap-2", active ? "text-white" : done ? "text-purple-200" : "text-slate-500")}>
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold",
                      active
                        ? "border-purple-300/50 bg-purple-400/15 text-white"
                        : done
                          ? "border-purple-300/40 bg-purple-400/10 text-purple-200"
                          : "border-white/10 bg-white/5 text-slate-500",
                    )}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em]">{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <Card className="p-6 sm:p-10">
          <div className="space-y-6">
            {error && (
              <div role="alert" aria-live="assertive" className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200">
                {error}
              </div>
            )}

            {step === 0 && (
              <div className="flex flex-col items-center gap-5 py-4 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-indigo-400/25 bg-indigo-400/10">
                  <DiscordIcon className="size-7 text-indigo-300" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Connect Your Discord Account</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                    Connect Discord to your Quest account before entering a Riot PUUID. Your identity stays private.
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClassName({ variant: "primary", size: "lg" })}
                  onClick={handleDiscordLogin}
                  disabled={loading}
                >
                  <DiscordIcon className="size-5" />
                  {loading ? "Connecting..." : "Connect Discord"}
                </button>
              </div>
            )}

            {step === 1 && discordUser && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-lg font-semibold text-white">Welcome, {discordUser.discord_username}</span>
                      <p className="mt-1 font-mono text-xs text-slate-500">Discord ID: {user.discordId || "Not available"}</p>
                    </div>
                    <Badge className="border-emerald-300/25 bg-emerald-400/10 text-emerald-200">
                      Discord Connected
                    </Badge>
                  </div>
                  <Link href="/profile?tab=account" className={buttonClassName({ variant: "ghost", size: "sm" })}>
                    Manage connection
                  </Link>
                </div>

                <div>
                  <h2 className="text-lg font-semibold text-white">Enter Your Riot PUUID</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Your PUUID (Player Universally Unique Identifier) is required to fetch your
                    Valorant stats.
                  </p>
                </div>

                <details className="group rounded-2xl border border-white/10 bg-white/[0.02]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-200 [&::-webkit-details-marker]:hidden">
                    <span>How to find your PUUID</span>
                    <svg
                      viewBox="0 0 20 20"
                      className="size-4 fill-none stroke-current stroke-[1.7] text-slate-400 transition group-open:rotate-180"
                      aria-hidden="true"
                    >
                      <path d="m5 7.5 5 5 5-5" />
                    </svg>
                  </summary>
                  <div className="border-t border-white/5 px-4 py-4 text-sm text-slate-400">
                    <ol className="list-decimal space-y-3 pl-5">
                      <li>
                        Sign in at{" "}
                        <a
                          href="https://account.riotgames.com/account"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-300 transition hover:text-purple-200"
                        >
                          account.riotgames.com/account
                        </a>
                      </li>
                      <li>
                        After signing in, go to{" "}
                        <a
                          href="https://account.riotgames.com/api/account/v1/user"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-300 transition hover:text-purple-200"
                        >
                          account.riotgames.com/api/account/v1/user
                        </a>
                      </li>
                      <li>
                        You will get a JSON response. Look for the{" "}
                        <strong className="text-slate-200">&quot;sub&quot;</strong> field — that&apos;s your
                        PUUID.
                      </li>
                    </ol>
                    <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs leading-relaxed text-slate-300">
                      {EXAMPLE_PUUID_JSON}
                    </pre>
                    <p className="mt-3 text-slate-400">
                      Your PUUID is the <strong className="text-slate-200">&quot;sub&quot;</strong> value:{" "}
                      <code className="text-purple-300">a91c72de-849a-4c2b-9e83-b45a8b3fdfe1</code>
                    </p>
                  </div>
                </details>

                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handlePuuidSubmit();
                  }}
                >
                  <div className="grid gap-2">
                    <label htmlFor="puuid" className="text-sm font-medium text-slate-300">
                      PUUID
                    </label>
                    <Input
                      id="puuid"
                      type="text"
                      value={puuid}
                      onChange={(event) => setPuuid(event.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={loading}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className={buttonClassName({ variant: "primary", size: "md" })}
                      disabled={loading || !puuid.trim()}
                    >
                      {loading ? "Checking..." : "Verify Player"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {step === 2 && preview && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">Confirm Your Registration</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Please verify this is your account before completing registration.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                  <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xl font-semibold text-white">
                      {preview.name}#{preview.tag}
                    </span>
                    <span className="text-sm text-slate-500">{discordUser?.discord_username}</span>
                  </div>
                  <dl className="divide-y divide-white/5 border-y border-white/5">
                    <DetailRow
                      label="Current rank"
                      value={
                        <span
                          className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-white"
                          style={{ backgroundColor: getRankColor(preview.current_rank) }}
                        >
                          {preview.current_rank}
                        </span>
                      }
                    />
                    <DetailRow label="ELO" value={preview.elo ? String(preview.elo) : "Unranked"} />
                    <DetailRow label="Peak rank" value={`${preview.peak_rank} (${preview.peak_season})`} />
                    <DetailRow label="Last played" value={formatLastPlayed(preview.last_played)} />
                    <DetailRow label="Discord" value={discordUser?.discord_username || "N/A"} />
                  </dl>
                </div>

                <div className="flex flex-col-reverse items-stretch justify-between gap-3 pt-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    className={buttonClassName({ variant: "ghost", size: "md" })}
                    onClick={handleDifferentPuuid}
                  >
                    Use different PUUID
                  </button>
                  <button
                    type="button"
                    className={buttonClassName({ variant: "primary", size: "md" })}
                    onClick={handleFinalSubmit}
                    disabled={loading}
                  >
                    {loading ? "Submitting..." : "Add to Leaderboard"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </Container>
  );
}
