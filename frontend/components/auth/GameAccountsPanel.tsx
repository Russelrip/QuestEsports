"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SupportHelpLink from "@/components/support/SupportHelpLink";
import ValorantConnectionBadge from "@/components/auth/ValorantConnectionBadge";
import ValorantRegistration from "@/components/valorant/ValorantRegistration";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { formatSriLankaDate } from "@/lib/date-time";
import { buildValorantTrackerProfileUrl } from "@/lib/valorant";
import {
  getMyGameAccounts,
  getMyValorantLeaderboardRegistration,
  importValorantFromLeaderboard,
  requestValorantChange,
  statusLabel,
  summarizeValorantConnection,
  verificationLabel,
  withdrawValorantChange,
  type GameAccountList,
  type LeaderboardRegistrationLookup,
} from "@/lib/game-accounts";

// Riot game names may contain spaces — "QT Russel#Senu" is an ordinary Riot ID
// — so the name excludes only `#` and control characters. The tag never
// contains whitespace, which is what keeps the separator unambiguous.
// Must stay in step with backend valorant.validation.js.
const RIOT_NAME_PATTERN = /^[^#\r\n\t]{1,32}$/;
const RIOT_TAG_PATTERN = /^[^#\s]{1,16}$/;

/** The element id the profile header scrolls to. */
export const GAME_ACCOUNTS_ANCHOR = "valorant-account";

export const isValidRiotId = (value: string): boolean => {
  const trimmed = value.trim();
  // Split on the LAST separator: anything before it belongs to the name.
  const separator = trimmed.lastIndexOf("#");
  if (separator <= 0) return false;
  const name = trimmed.slice(0, separator);
  const tag = trimmed.slice(separator + 1);
  return RIOT_NAME_PATTERN.test(name) && name.trim().length > 0 && RIOT_TAG_PATTERN.test(tag);
};

type GameAccountsPanelProps = {
  className?: string;
  /** Told about every successful load, so the profile header never disagrees with the panel. */
  onAccountsChange?: (list: GameAccountList) => void;
};

const inputClassName =
  "mt-2 w-full border border-white/10 bg-white/[.03] p-3 text-white outline-none focus:border-cyan-300/40";

export default function GameAccountsPanel({ className = "", onAccountsChange }: GameAccountsPanelProps) {
  const [list, setList] = useState<GameAccountList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // What the leaderboard already holds for this player's Discord. A player who
  // registered before registration connected the account here is already on the
  // leaderboard, so the registration steps would stop them at "already
  // registered"; they are offered that account, by name, instead. It is also
  // how a connected player learns that staff hid them from the public board.
  const [leaderboard, setLeaderboard] = useState<LeaderboardRegistrationLookup | null>(null);
  const [leaderboardSettled, setLeaderboardSettled] = useState(false);
  const [importing, setImporting] = useState(false);

  // Changing the account behind a competitive identity is deliberate, so it
  // sits behind an explicit toggle rather than being an always-visible field.
  const [changing, setChanging] = useState(false);
  const [changeRiotId, setChangeRiotId] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [submittingChange, setSubmittingChange] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Held in a ref so a parent passing a fresh callback each render does not
  // re-trigger the initial load.
  const onAccountsChangeRef = useRef(onAccountsChange);
  useEffect(() => {
    onAccountsChangeRef.current = onAccountsChange;
  }, [onAccountsChange]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadingError("");
    try {
      const next = await getMyGameAccounts();
      setList(next);
      onAccountsChangeRef.current?.(next);
    } catch (reason) {
      setLoadingError(reason instanceof Error ? reason.message : "Could not load your game accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const valorant = list?.accounts.find((account) => account.game === "valorant") ?? null;
  const summary = summarizeValorantConnection(list);
  const changeRequest = list?.changeRequest ?? null;
  const pendingRequest = changeRequest?.status === "pending" ? changeRequest : null;
  const hasAccount = Boolean(valorant);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    setLeaderboardSettled(false);
    getMyValorantLeaderboardRegistration()
      .then((result) => {
        if (!cancelled) setLeaderboard(result);
      })
      .catch(() => {
        // Only ever a shortcut. Without it the registration steps are still there.
        if (!cancelled) setLeaderboard(null);
      })
      .finally(() => {
        if (!cancelled) setLeaderboardSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, hasAccount]);

  // For a player already on the VALORANT leaderboard but not connected here.
  //
  // They registered before registering also connected the account, so Quest
  // adopts what they registered. The server re-resolves the Riot ID and refuses
  // if it now belongs to a different account.
  const importFromLeaderboard = async () => {
    setImporting(true);
    setError("");
    setNotice("");
    try {
      await importValorantFromLeaderboard();
      setNotice("Connected the VALORANT account from your leaderboard registration.");
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not import your leaderboard account."
      );
    } finally {
      setImporting(false);
    }
  };

  const closeChange = () => {
    setChanging(false);
    setChangeRiotId("");
    setChangeReason("");
  };

  const submitChange = async () => {
    const nextRiotId = changeRiotId.trim();
    if (!isValidRiotId(nextRiotId)) {
      setError("Enter the new Riot ID as Name#Tag.");
      return;
    }
    // No reason check here. A rename needs none; a different account does, and
    // only the server can tell the two apart — it answers with what is missing.
    setSubmittingChange(true);
    setError("");
    setNotice("");
    try {
      const result = await requestValorantChange(nextRiotId, changeReason.trim());
      if (result.kind === "rename") {
        // Same underlying account: nothing to review, so say so plainly rather
        // than implying a request is pending.
        setNotice(
          result.refreshed
            ? "That is the same account under a new Riot name, so we just refreshed it. No review needed."
            : "That is already your current account — nothing changed.",
        );
      } else {
        setNotice("Request sent. An admin will review it and you will keep your current account until then.");
      }
      closeChange();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not request an account change.");
    } finally {
      setSubmittingChange(false);
    }
  };

  const withdrawChange = async () => {
    setWithdrawing(true);
    setError("");
    setNotice("");
    try {
      await withdrawValorantChange();
      setNotice("Request withdrawn. Your current account is unchanged.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not withdraw your change request.");
    } finally {
      setWithdrawing(false);
    }
  };

  const trackerUrl = valorant?.username && valorant?.tagline
    ? buildValorantTrackerProfileUrl(valorant.username, valorant.tagline)
    : null;

  const offer = !loading && !valorant ? leaderboard?.registration ?? null : null;
  const hiddenFromBoard = !loading && leaderboard?.registration?.hidden ? leaderboard.registration : null;

  return (
    <section
      id={GAME_ACCOUNTS_ANCHOR}
      className={`scroll-mt-24 border-t border-white/8 pt-8 ${className}`}
      aria-labelledby="game-accounts-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Competitive identity</p>
          <h3 id="game-accounts-heading" className="mt-2 text-2xl text-white">VALORANT account</h3>
        </div>
        <p className="max-w-sm text-sm leading-6 text-slate-400">
          Register the account you compete on for the VALORANT leaderboard to connect it. Captains
          will not need to type it when registering a team.
        </p>
      </div>

      {/* Only when there is something to wait for or act on. A connected
          account and an empty form each already say where things stand. */}
      {!loading && !loadingError && (summary.state === "pending" || summary.state === "attention") ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 border border-white/8 bg-white/[.02] p-4" role="status">
          <ValorantConnectionBadge state={summary.state} label={summary.label} />
          <p className="min-w-0 flex-1 text-sm leading-6 text-slate-300">{summary.detail}</p>
        </div>
      ) : null}

      {hiddenFromBoard ? (
        <div className="mt-5 border border-amber-300/20 bg-amber-400/[0.06] p-4" role="status">
          <p className="text-[10px] uppercase tracking-[0.22em] text-amber-200/80">Hidden from the public leaderboard</p>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            Staff have hidden {hiddenFromBoard.riotId} from the public VALORANT leaderboard. You are still registered, your
            account stays connected, and your rank keeps updating — it just is not shown on the board.
          </p>
          {hiddenFromBoard.hiddenReason ? (
            <p className="mt-2 break-words text-sm leading-6 text-slate-300 [overflow-wrap:anywhere]">
              <span className="text-slate-400">Reason:</span> {hiddenFromBoard.hiddenReason}
            </p>
          ) : null}
          <SupportHelpLink subject="Hidden from the VALORANT leaderboard" />
        </div>
      ) : null}

      {notice ? <p className="mt-5 border border-emerald-300/20 bg-emerald-400/8 p-3 text-sm text-emerald-100" role="status">{notice}</p> : null}
      {error ? <p className="mt-5 border border-rose-300/20 bg-rose-400/8 p-3 text-sm leading-6 text-rose-100" role="alert">{error}<br /><SupportHelpLink subject="Game account issue" /></p> : null}
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
            <div className="min-w-0">
              <h4 className="font-semibold text-white">VALORANT</h4>
              <p className="mt-1 break-words [overflow-wrap:anywhere] text-lg text-white">
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
          {valorant.verificationStatus === "legacy_unverified" || valorant.status === "revoked" ? (
            <p className="mt-4 text-sm leading-6 text-amber-100">
              {valorant.status === "revoked"
                ? "This account was revoked and no longer counts for registrations."
                : "This account came from an older record and has not been confirmed as yours."}{" "}
              <SupportHelpLink subject="VALORANT account needs attention" />
            </p>
          ) : null}
          {trackerUrl ? (
            <a className="mt-4 inline-block text-sm text-cyan-200 underline" href={trackerUrl} target="_blank" rel="noreferrer noopener">
              View on tracker.gg
            </a>
          ) : null}

          {pendingRequest ? (
            // The request is the thing the player is waiting on, so it is shown
            // in full — what they asked for and why — with a way to take it back.
            // Without that a mistyped request is a dead end until an admin
            // rejects it.
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-amber-200/80">Change waiting for review</p>
              <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-xs text-slate-500">Requested account</dt><dd className="mt-1 break-words [overflow-wrap:anywhere] text-white">{pendingRequest.requestedIdentity}</dd></div>
                <div><dt className="text-xs text-slate-500">Requested</dt><dd className="mt-1 text-white">{formatSriLankaDate(pendingRequest.requestedAt)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Your reason</dt><dd className="mt-1 break-words [overflow-wrap:anywhere] text-slate-300">{pendingRequest.reason}</dd></div>
              </dl>
              <Button type="button" variant="ghost" className="mt-4" disabled={withdrawing} onClick={() => void withdrawChange()}>
                {withdrawing ? "Withdrawing…" : "Withdraw request"}
              </Button>
            </div>
          ) : changeRequest?.status === "rejected" ? (
            <div className="mt-5 border-t border-white/10 pt-5 text-sm leading-6">
              <p className="text-slate-300">
                An admin declined your change to <strong className="text-white">{changeRequest.requestedIdentity}</strong>
                {changeRequest.reviewedAt ? ` on ${formatSriLankaDate(changeRequest.reviewedAt)}` : ""}.
              </p>
              {changeRequest.adminNote ? <p className="mt-1 break-words [overflow-wrap:anywhere] text-slate-400">Reason: {changeRequest.adminNote}</p> : null}
            </div>
          ) : changeRequest?.status === "approved" ? (
            <p className="mt-5 border-t border-white/10 pt-5 text-sm leading-6 text-slate-300">
              An admin approved your change to <strong className="text-white">{changeRequest.requestedIdentity}</strong>.
            </p>
          ) : null}

          {/* Renamed on Riot? Nothing to do — the same entry point handles it
              and the server tells the two apart by the stable identifier. A
              second change cannot be queued behind a pending one, so the entry
              point is withheld until that one is settled. */}
          {pendingRequest ? null : changing ? (
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className="text-sm leading-6 text-slate-400">
                Renamed on Riot? Just enter your new ID — we will recognise it as the same
                account and refresh it. Moving to a <strong className="text-slate-200">different</strong>{" "}
                account needs an admin to approve it, and you keep this one until they do.
              </p>

              <label className="mt-4 block text-xs uppercase tracking-[0.15em] text-slate-500" htmlFor="change-riot-id">
                New Riot ID
              </label>
              <input
                id="change-riot-id"
                className={inputClassName}
                placeholder="Name#Tag"
                autoComplete="off"
                value={changeRiotId}
                onChange={(event) => setChangeRiotId(event.target.value)}
              />

              <label className="mt-4 block text-xs uppercase tracking-[0.15em] text-slate-500" htmlFor="change-reason">
                Why is it changing?
              </label>
              <textarea
                id="change-reason"
                rows={2}
                aria-describedby="change-reason-hint"
                className={inputClassName}
                placeholder="e.g. I lost access to my old Riot account"
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
              />
              <p id="change-reason-hint" className="mt-2 text-xs text-slate-500">
                Only needed for a different account — an admin reads it. Leave it empty for a rename.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" variant="secondary" disabled={submittingChange} onClick={() => void submitChange()}>
                  {submittingChange ? "Sending…" : "Request change"}
                </Button>
                <Button type="button" variant="ghost" disabled={submittingChange} onClick={() => { closeChange(); setError(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" className="mt-4 sm:ml-4" onClick={() => { setChanging(true); setNotice(""); setError(""); }}>
              Change account
            </Button>
          )}
        </article>
      ) : (
        leaderboardSettled ? (
          offer ? (
            <div className="mt-6 border border-cyan-300/20 bg-cyan-400/[0.06] p-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Already on the VALORANT leaderboard</p>
              <p className="mt-2 break-words text-lg text-white [overflow-wrap:anywhere]">{offer.riotId}</p>
              {!offer.linkedElsewhere ? (
                <>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                    You registered this account with the Discord connected here. Connect it to your
                    profile — there is nothing to register again.
                  </p>
                  <Button type="button" variant="secondary" className="mt-4" disabled={importing} onClick={() => void importFromLeaderboard()}>
                    {importing ? "Connecting…" : `Connect ${offer.riotId}`}
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm leading-6 text-rose-100" role="alert">
                  {offer.unclaimedRecord
                    ? "This account belongs to an older Quest player record that is not connected to any account. Contact support so an admin can move it, and its history, to you."
                    : "This account is already linked to another Quest account. If it is yours, contact support."}{" "}
                  <SupportHelpLink subject="Linked game account issue" />
                </p>
              )}
            </div>
          ) : (
            <div className="mt-6">
              <ValorantRegistration
                onRegistered={(result) => {
                  // The leaderboard committed either way. If Quest could not
                  // connect the account too, the refresh lands on the offer
                  // above, which connects the registration it can now see.
                  setNotice(
                    result?.account
                      ? "You're on the VALORANT leaderboard, and your account is connected."
                      : "You're on the VALORANT leaderboard. Connect the account below to finish."
                  );
                  void refresh();
                }}
              />
            </div>
          )
        ) : (
          <div className="mt-6"><LoadingState title="Checking the VALORANT leaderboard" description="Looking for a registration under your Discord." /></div>
        )
      )}
    </section>
  );
}
