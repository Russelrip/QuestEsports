"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import {
  getLinkedProviders,
  getProviderLinkUrl,
  type LinkedProvider,
  type OAuthProvider,
  unlinkProvider,
} from "@/lib/account-linking";

// Two descriptions per provider, because one string cannot serve both states:
// "Connect Discord so staff can reach you" reads as an instruction to someone
// who has already connected it, and leaves them wondering what else to do.
const providerDetails: Record<
  OAuthProvider,
  { name: string; prompt: string; connected: string; mark: string; derivesProfileData?: boolean }
> = {
  google: {
    name: "Google",
    prompt: "Use your Google identity to sign in faster.",
    connected: "You can sign in with Google.",
    mark: "G",
  },
  // Discord is how tournament communication reaches a player, so it is framed
  // as something worth connecting rather than a second way to sign in.
  discord: {
    name: "Discord",
    prompt: "Connect Discord so your captain and tournament staff can reach you. Some tournaments require it.",
    connected: "Your captain and tournament staff can reach you on Discord.",
    mark: "D",
    // Discord is the only provider that fills in a profile field, so it is the
    // only one worth reconnecting once already linked.
    derivesProfileData: true,
  },
};

type AccountLinkingPanelProps = { className?: string };

export default function AccountLinkingPanel({ className = "" }: AccountLinkingPanelProps) {
  const { refreshSession } = useAuth();
  const [providers, setProviders] = useState<LinkedProvider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadingError("");
    try {
      setProviders(await getLinkedProviders());
    } catch (reason) {
      setLoadingError(reason instanceof Error ? reason.message : "Could not load linked accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("oauth");
    if (oauthResult === "linked") setNotice("Account linked successfully. Your provider list is up to date.");
    if (oauthResult === "error") setError("We could not link that account. It may already be linked to another Quest account.");
    if (oauthResult) {
      params.delete("oauth");
      params.delete("tab");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
    void Promise.all([refresh(), oauthResult === "linked" ? refreshSession() : Promise.resolve()]);
  }, [refresh, refreshSession]);

  const providerState = (provider: OAuthProvider) => providers?.find((entry) => entry.provider === provider);

  const link = (provider: OAuthProvider) => {
    setError("");
    setNotice("");
    window.location.assign(getProviderLinkUrl(provider));
  };

  const unlink = async (provider: OAuthProvider) => {
    setPendingProvider(provider);
    setError("");
    setNotice("");
    try {
      setProviders(await unlinkProvider(provider));
      setNotice(`${providerDetails[provider].name} has been unlinked.`);
      // Unlinking Discord clears the verified tag on the server. Without this
      // the profile keeps showing the old handle as if it were still vouched
      // for, until the next full page load.
      await refreshSession();
    } catch (reason) {
      const typedReason = reason as Error & { code?: string };
      setError(
        typedReason.code === "OAUTH_LAST_LOGIN_METHOD"
          ? "Keep a verified password or another linked provider before unlinking this account."
          : typedReason.code === "OAUTH_ACCOUNT_CONFLICT"
            ? "That provider account is already linked to another Quest account."
            : typedReason.message || "Could not unlink this account."
      );
      await refresh();
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <section className={`border-t border-white/8 pt-8 ${className}`} aria-labelledby="linked-accounts-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Connected accounts</p>
          <h3 id="linked-accounts-heading" className="mt-2 text-2xl text-white">Linked accounts</h3>
        </div>
        <p className="max-w-sm text-sm leading-6 text-slate-400">Sign in faster, and let tournament staff reach you on Discord. You can unlink a provider later as long as another secure login method remains.</p>
      </div>

      {notice ? <p className="mt-5 border border-emerald-300/20 bg-emerald-400/8 p-3 text-sm text-emerald-100" role="status">{notice}</p> : null}
      {error ? <p className="mt-5 border border-rose-300/20 bg-rose-400/8 p-3 text-sm leading-6 text-rose-100" role="alert">{error}</p> : null}
      {loadingError ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-rose-300/20 bg-rose-400/8 p-3 text-sm text-rose-100" role="alert"><span>{loadingError}</span><Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>Try again</Button></div> : null}

      {loading ? <div className="mt-6"><LoadingState title="Loading linked accounts" description="Checking your Google and Discord connections." /></div> : providers === null ? null : (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {(["google", "discord"] as OAuthProvider[]).map((provider) => {
            const state = providerState(provider);
            const linked = state?.linked === true;
            const known = Boolean(state);
            const pending = pendingProvider === provider;
            const details = providerDetails[provider];
            return <article key={provider} className={`border p-5 transition ${linked ? "border-cyan-300/25 bg-cyan-400/[.055]" : "border-white/8 bg-white/[.02]"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-white text-lg font-bold text-slate-950" aria-hidden="true">{details.mark}</span><div><h4 className="font-semibold text-white">{details.name}</h4><p className="mt-1 text-xs uppercase tracking-[0.15em] text-slate-500">{!known ? "Status unavailable" : linked ? "Connected" : "Not connected"}</p></div></div>
                <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${linked ? "text-cyan-200" : "text-slate-500"}`}>{!known ? "Unavailable" : linked ? "Linked" : "Available"}</span>
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-400">{linked ? details.connected : details.prompt}</p>
              {linked ? <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                {/* Connections made before the tag was recorded left the profile
                    field empty, and unlinking to fix it is refused when Discord
                    is the only login method. Re-running the link is the way out. */}
                {details.derivesProfileData ? <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={pending} onClick={() => link(provider)}>{`Reconnect ${details.name}`}</Button> : null}
                <Button type="button" variant="ghost" className="w-full sm:w-auto" disabled={pending} onClick={() => void unlink(provider)}>{pending ? "Unlinking…" : `Unlink ${details.name}`}</Button>
              </div> : <Button type="button" variant="secondary" className="mt-4 w-full sm:w-auto" disabled={!known} onClick={() => link(provider)}>{known ? `Link ${details.name}` : "Unavailable"}</Button>}
            </article>;
          })}
        </div>
      )}
    </section>
  );
}
