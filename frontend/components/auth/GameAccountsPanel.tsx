"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { buildValorantTrackerProfileUrl } from "@/lib/valorant";
import {
  getMyGameAccounts,
  linkValorantAccount,
  resolveValorantAccount,
  statusLabel,
  verificationLabel,
  type GameAccount,
  type ResolvedGameAccount,
} from "@/lib/game-accounts";

// Long enough that a player typing "Russel#1234" produces one lookup rather
// than eleven, short enough that the result feels immediate.
const LOOKUP_DEBOUNCE_MS = 500;
// Riot game names may contain spaces — "QT Russel#Senu" is an ordinary Riot ID
// — so the name excludes only `#` and control characters. The tag never
// contains whitespace, which is what keeps the separator unambiguous.
// Must stay in step with backend valorant.validation.js.
const RIOT_NAME_PATTERN = /^[^#\r\n\t]{1,32}$/;
const RIOT_TAG_PATTERN = /^[^#\s]{1,16}$/;

export const isValidRiotId = (value: string): boolean => {
  const trimmed = value.trim();
  // Split on the LAST separator: anything before it belongs to the name.
  const separator = trimmed.lastIndexOf("#");
  if (separator <= 0) return false;
  const name = trimmed.slice(0, separator);
  const tag = trimmed.slice(separator + 1);
  return RIOT_NAME_PATTERN.test(name) && name.trim().length > 0 && RIOT_TAG_PATTERN.test(tag);
};

type GameAccountsPanelProps = { className?: string };

export default function GameAccountsPanel({ className = "" }: GameAccountsPanelProps) {
  const [accounts, setAccounts] = useState<GameAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");

  const [riotId, setRiotId] = useState("");
  const [resolved, setResolved] = useState<ResolvedGameAccount | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Every lookup carries a sequence number so a slow earlier response can never
  // overwrite a newer one when the player keeps typing.
  const lookupSequence = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadingError("");
    try {
      const list = await getMyGameAccounts();
      setAccounts(list.accounts);
    } catch (reason) {
      setLoadingError(reason instanceof Error ? reason.message : "Could not load your game accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const trimmed = riotId.trim();
    setError("");

    if (!trimmed) {
      setResolved(null);
      setLookupError("");
      setLooking(false);
      return;
    }

    // Reject locally what cannot possibly resolve, so a malformed entry never
    // spends the shared upstream budget.
    if (!isValidRiotId(trimmed)) {
      setResolved(null);
      setLookupError("Enter your Riot ID as Name#Tag.");
      setLooking(false);
      return;
    }

    setLookupError("");
    setLooking(true);
    const sequence = ++lookupSequence.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = await resolveValorantAccount(trimmed);
        if (sequence !== lookupSequence.current) return;
        setResolved(result);
      } catch (reason) {
        if (sequence !== lookupSequence.current) return;
        setResolved(null);
        setLookupError(reason instanceof Error ? reason.message : "Could not look up that Riot ID.");
      } finally {
        if (sequence === lookupSequence.current) setLooking(false);
      }
    }, LOOKUP_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [riotId]);

  const confirm = async () => {
    if (!resolved) return;
    setLinking(true);
    setError("");
    setNotice("");
    try {
      await linkValorantAccount(riotId.trim());
      setNotice("Your VALORANT account is connected.");
      setRiotId("");
      setResolved(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not link that VALORANT account.");
    } finally {
      setLinking(false);
    }
  };

  const valorant = accounts?.find((account) => account.game === "valorant") ?? null;
  const trackerUrl = valorant?.username && valorant?.tagline
    ? buildValorantTrackerProfileUrl(valorant.username, valorant.tagline)
    : null;

  return (
    <section className={`border-t border-white/8 pt-8 ${className}`} aria-labelledby="game-accounts-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Competitive identity</p>
          <h3 id="game-accounts-heading" className="mt-2 text-2xl text-white">Game accounts</h3>
        </div>
        <p className="max-w-sm text-sm leading-6 text-slate-400">
          Connect the account you compete on. Your captain will not need to type it when registering a team.
        </p>
      </div>

      {notice ? <p className="mt-5 border border-emerald-300/20 bg-emerald-400/8 p-3 text-sm text-emerald-100" role="status">{notice}</p> : null}
      {error ? <p className="mt-5 border border-rose-300/20 bg-rose-400/8 p-3 text-sm leading-6 text-rose-100" role="alert">{error}</p> : null}
      {loadingError ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-rose-300/20 bg-rose-400/8 p-3 text-sm text-rose-100" role="alert">
          <span>{loadingError}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6"><LoadingState title="Loading game accounts" description="Checking your connected competitive accounts." /></div>
      ) : valorant ? (
        <article className="mt-6 border border-cyan-300/25 bg-cyan-400/[.055] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-semibold text-white">VALORANT</h4>
              <p className="mt-1 text-lg text-white">
                {valorant.username}#{valorant.tagline}
              </p>
              {valorant.region ? <p className="mt-1 text-xs uppercase tracking-[0.15em] text-slate-500">Region: {valorant.region}</p> : null}
            </div>
            <div className="text-right">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">{statusLabel(valorant.status)}</span>
              {/* Say what was actually established. "Confirmed by you" is not
                  "verified", and the difference matters to a captain. */}
              <p className="mt-1 text-xs text-slate-400">{verificationLabel(valorant.verificationStatus)}</p>
            </div>
          </div>
          {valorant.status === "locked" ? (
            <p className="mt-4 text-sm leading-6 text-slate-400">
              This account is locked because it is on a registered tournament roster. Ask an admin if it needs to change.
            </p>
          ) : null}
          {trackerUrl ? (
            <a className="mt-4 inline-block text-sm text-cyan-200 underline" href={trackerUrl} target="_blank" rel="noreferrer noopener">
              View on tracker.gg
            </a>
          ) : null}
        </article>
      ) : (
        <div className="mt-6 border border-white/8 bg-white/[.02] p-5">
          <h4 className="font-semibold text-white">VALORANT</h4>
          <p className="mt-1 text-sm leading-6 text-slate-400">Enter your Riot ID and confirm the account we find.</p>

          <label className="mt-5 block text-xs uppercase tracking-[0.15em] text-slate-500" htmlFor="riot-id">Riot ID</label>
          <input
            id="riot-id"
            className="mt-2 w-full border border-white/10 bg-white/[.03] p-3 text-white outline-none focus:border-cyan-300/40"
            placeholder="Name#Tag"
            value={riotId}
            autoComplete="off"
            onChange={(event) => setRiotId(event.target.value)}
          />

          {looking ? <p className="mt-3 text-sm text-slate-400" role="status">Checking…</p> : null}
          {lookupError ? <p className="mt-3 text-sm text-rose-200" role="alert">{lookupError}</p> : null}

          {resolved && !looking ? (
            <div className="mt-4 border border-white/10 bg-white/[.03] p-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">VALORANT account found</p>
              <p className="mt-2 text-lg text-white">{resolved.username}#{resolved.tagline}</p>
              {resolved.region ? <p className="mt-1 text-xs uppercase tracking-[0.15em] text-slate-500">Region: {resolved.region}</p> : null}
              {resolved.preview?.currenttierpatched || resolved.preview?.current_tier ? (
                <p className="mt-1 text-sm text-slate-300">
                  Rank: {resolved.preview.currenttierpatched ?? resolved.preview.current_tier}
                </p>
              ) : null}

              {resolved.linkedToYou ? (
                <p className="mt-4 text-sm text-emerald-100">This account is already connected to your profile.</p>
              ) : resolved.linkedElsewhere ? (
                <p className="mt-4 text-sm leading-6 text-rose-100" role="alert">
                  This VALORANT account is already linked to another Quest account. If it is yours, contact support.
                </p>
              ) : (
                <>
                  <p className="mt-4 text-sm leading-6 text-slate-400">
                    Is this your account? Connecting it records that you confirmed it — it does not prove ownership to Riot.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button type="button" variant="secondary" disabled={linking} onClick={() => void confirm()}>
                      {linking ? "Connecting…" : "Connect account"}
                    </Button>
                    <Button type="button" variant="ghost" disabled={linking} onClick={() => { setRiotId(""); setResolved(null); }}>
                      Not my account
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
