"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SupportHelpLink from "@/components/support/SupportHelpLink";
import ValorantConnectionBadge from "@/components/auth/ValorantConnectionBadge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { formatSriLankaDate } from "@/lib/date-time";
import { buildValorantTrackerProfileUrl } from "@/lib/valorant";
import {
  getMyGameAccounts,
  getMyValorantLeaderboardRegistration,
  importValorantFromLeaderboard,
  leaderboardRegistrationMessage,
  linkValorantAccount,
  requestValorantChange,
  resolveValorantAccount,
  statusLabel,
  summarizeValorantConnection,
  verificationLabel,
  withdrawValorantChange,
  type GameAccountList,
  type LeaderboardRegistrationLookup,
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

// The statuses in which a row is the player's current account. Must stay in
// step with CURRENT_STATUSES in backend game-account.service.js.
const CURRENT_STATUSES = new Set(["active", "locked", "change_requested"]);

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

  const [riotId, setRiotId] = useState("");
  const [resolved, setResolved] = useState<ResolvedGameAccount | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // What the leaderboard already holds for this player's Discord. Fetched only
  // for somebody with nothing connected, and shown as the account it is — a
  // Riot ID they can recognise — rather than a blind "import" button.
  const [leaderboard, setLeaderboard] = useState<LeaderboardRegistrationLookup | null>(null);
  const [leaderboardDismissed, setLeaderboardDismissed] = useState(false);
  const [importing, setImporting] = useState(false);

  // Changing the account behind a competitive identity is deliberate, so it
  // sits behind an explicit toggle rather than being an always-visible field.
  const [changing, setChanging] = useState(false);
  const [changeRiotId, setChangeRiotId] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [submittingChange, setSubmittingChange] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Every lookup carries a sequence number so a slow earlier response can never
  // overwrite a newer one when the player keeps typing.
  const lookupSequence = useRef(0);
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
    if (loading || hasAccount) return;
    let cancelled = false;
    getMyValorantLeaderboardRegistration()
      .then((result) => {
        if (!cancelled) setLeaderboard(result);
      })
      .catch(() => {
        // Only ever a shortcut. Without it the Riot ID field is still there.
        if (!cancelled) setLeaderboard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, hasAccount]);

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
      // Link exactly the account on the card. The player may have typed the
      // name in another case; what they confirmed is what Riot returned.
      const displayed =
        resolved.username && resolved.tagline ? `${resolved.username}#${resolved.tagline}` : riotId.trim();
      const account = await linkValorantAccount(displayed);
      // Connecting also puts them on the leaderboard, so the confirmation says
      // what actually happened there — including the one case they have to act
      // on, an entry still pointing at an account they no longer use.
      const leaderboardMessage = leaderboardRegistrationMessage(account.leaderboard);
      setNotice(
        leaderboardMessage
          ? `Your VALORANT account is connected. ${leaderboardMessage}`
          : "Your VALORANT account is connected."
      );
      setRiotId("");
      setResolved(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not link that VALORANT account.");
    } finally {
      setLinking(false);
    }
  };

  // For a player already on the VALORANT leaderboard.
  //
  // That registration asked for the same proof through a longer door — a
  // connected Discord and a PUUID copied from their own Riot account page. The
  // server still re-resolves the Riot ID and refuses if it now belongs to a
  // different account, so this is a shortcut through the same door rather than
  // a second one.
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

  const offer = !loading && !valorant && !leaderboardDismissed ? leaderboard?.registration ?? null : null;
  const offerAvailable = Boolean(offer && !offer.linkedToYou && !offer.linkedElsewhere);

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
          Connect the account you compete on. Captains will not need to type it when registering a
          team, and it puts you on the VALORANT leaderboard — there is no separate registration.
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
        <>
          {offer ? (
            <div className="mt-6 border border-cyan-300/20 bg-cyan-400/[0.06] p-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Found on the VALORANT leaderboard</p>
              <p className="mt-2 break-words [overflow-wrap:anywhere] text-lg text-white">{offer.riotId}</p>
              {offerAvailable ? (
                <>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                    You registered this account on the leaderboard with the Discord you connected here.
                    If it is still the account you play on, connect it — there is nothing to retype.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button type="button" variant="secondary" disabled={importing} onClick={() => void importFromLeaderboard()}>
                      {importing ? "Connecting…" : `Connect ${offer.riotId}`}
                    </Button>
                    <Button type="button" variant="ghost" disabled={importing} onClick={() => setLeaderboardDismissed(true)}>
                      Use a different account
                    </Button>
                  </div>
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
          ) : null}

          <div className="mt-6 border border-white/8 bg-white/[.02] p-5">
            <h4 className="font-semibold text-white">{offerAvailable ? "Or enter a different Riot ID" : "Connect with your Riot ID"}</h4>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Enter your Riot ID and confirm the account we find. You can see it in the VALORANT client under your name.
            </p>
            {leaderboard && !leaderboard.discordConnected ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Connect Discord under Linked accounts too if you want to appear on the VALORANT leaderboard.
              </p>
            ) : null}

            <label className="mt-5 block text-xs uppercase tracking-[0.15em] text-slate-500" htmlFor="riot-id">Riot ID</label>
            <input
              id="riot-id"
              className={inputClassName}
              placeholder="Name#Tag"
              value={riotId}
              autoComplete="off"
              onChange={(event) => setRiotId(event.target.value)}
            />

            {looking ? <p className="mt-3 text-sm text-slate-400" role="status">Checking…</p> : null}
            {lookupError ? <p className="mt-3 text-sm text-rose-200" role="alert">{lookupError}</p> : null}

            {resolved && !looking ? (
              <ResolvedAccountCard
                resolved={resolved}
                linking={linking}
                onConfirm={() => void confirm()}
                onReject={() => { setRiotId(""); setResolved(null); }}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function ResolvedAccountCard({
  resolved,
  linking,
  onConfirm,
  onReject,
}: {
  resolved: ResolvedGameAccount;
  linking: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const rank = resolved.preview?.currenttierpatched ?? resolved.preview?.current_tier ?? null;
  const peak = resolved.preview?.peak_rank?.tier ?? null;
  const lastPlayed = resolved.preview?.last_played_match ?? null;
  const heldAsCurrent = resolved.linkedToYou && (!resolved.status || CURRENT_STATUSES.has(resolved.status));
  // Only a real comparison that failed is a warning. Nothing to compare with —
  // no Discord, no registration, a leaderboard that did not answer — is silence.
  const leaderboardMismatch = resolved.leaderboard && !resolved.leaderboard.matches ? resolved.leaderboard : null;

  return (
    <div className="mt-4 border border-white/10 bg-white/[.03] p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">VALORANT account found</p>
      <p className="mt-2 break-words [overflow-wrap:anywhere] text-lg text-white">{resolved.username}#{resolved.tagline}</p>
      {/* Enough to recognise an account at a glance. A Riot ID one character off
          belongs to somebody else, and these are how a player notices. */}
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {resolved.region ? <div className="flex gap-1.5"><dt className="text-slate-500">Region</dt><dd className="uppercase text-slate-200">{resolved.region}</dd></div> : null}
        {rank ? <div className="flex gap-1.5"><dt className="text-slate-500">Rank</dt><dd className="text-slate-200">{rank}</dd></div> : null}
        {peak ? <div className="flex gap-1.5"><dt className="text-slate-500">Peak</dt><dd className="text-slate-200">{peak}</dd></div> : null}
        {lastPlayed ? <div className="flex gap-1.5"><dt className="text-slate-500">Last match</dt><dd className="text-slate-200">{formatSriLankaDate(lastPlayed)}</dd></div> : null}
      </dl>

      {heldAsCurrent ? (
        <p className="mt-4 text-sm text-emerald-100">This account is already connected to your profile.</p>
      ) : resolved.linkedToYou ? (
        <p className="mt-4 text-sm leading-6 text-slate-300">
          You used this account before. Use Change account to move back to it — an admin approves the move.
        </p>
      ) : resolved.linkedElsewhere ? (
        <p className="mt-4 text-sm leading-6 text-rose-100" role="alert">
          {resolved.unclaimedRecord
            ? "This VALORANT account belongs to an older Quest player record that is not connected to any account. Contact support so an admin can move it, and its history, to you."
            : "This VALORANT account is already linked to another Quest account. If it is yours, contact support."}{" "}
          <SupportHelpLink subject="Linked game account issue" />
        </p>
      ) : (
        <>
          {leaderboardMismatch ? (
            <p className="mt-4 border border-amber-300/20 bg-amber-400/8 p-3 text-sm leading-6 text-amber-100" role="alert">
              This is not the account your Discord is registered with on the leaderboard
              {leaderboardMismatch.riotId ? ` (${leaderboardMismatch.riotId})` : ""}. Check it is yours before
              connecting — your leaderboard entry will not move to it.
            </p>
          ) : null}
          <p className="mt-4 text-sm leading-6 text-slate-400">
            Is this your account? Connecting it records that you confirmed it — it does not prove ownership to Riot.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" variant="secondary" disabled={linking} onClick={onConfirm}>
              {linking ? "Connecting…" : "Connect account"}
            </Button>
            <Button type="button" variant="ghost" disabled={linking} onClick={onReject}>
              Not my account
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
