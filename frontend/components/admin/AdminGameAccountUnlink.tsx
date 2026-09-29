"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { hasStaffPermission } from "@/lib/staff-permissions";
import {
  accountStatusLabel,
  searchGameAccounts,
  unlinkGameAccount,
  type AdminGameAccount,
  type UnlinkResult,
} from "@/lib/game-account-admin";

const MIN_REASON_LENGTH = 10;

const holderLine = (player: AdminGameAccount["player"]) => {
  const parts = [player.displayName, player.username ? `@${player.username}` : null].filter(Boolean);
  return parts.join(" · ") || "Unknown player";
};

const leaderboardMessage = (leaderboard: UnlinkResult["leaderboard"]) => {
  if (!leaderboard) return null;
  switch (leaderboard.state) {
    case "removed":
      return "Their leaderboard registration was removed too — it can be restored from the VALORANT leaderboard removals page.";
    case "failed":
      return "The leaderboard registration could NOT be removed. Remove it from the VALORANT leaderboard page, or the board still names the old holder.";
    case "not_permitted":
      return "The leaderboard registration was left alone: that needs the VALORANT leaderboard area.";
    default:
      return null;
  }
};

export default function AdminGameAccountUnlink() {
  const { user } = useAuth();
  const mayTouchLeaderboard = hasStaffPermission(user, "valorant_leaderboard");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminGameAccount[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminGameAccount | null>(null);
  const [reason, setReason] = useState("");
  const [allowLocked, setAllowLocked] = useState(false);
  const [releaseLeaderboard, setReleaseLeaderboard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UnlinkResult | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setSearching(true);
    setError("");
    setResult(null);
    setSelected(null);
    try {
      setResults(await searchGameAccounts(query.trim()));
    } catch (reasonForFailure) {
      setResults(null);
      setError(reasonForFailure instanceof Error ? reasonForFailure.message : "That search failed.");
    } finally {
      setSearching(false);
    }
  };

  const select = (account: AdminGameAccount) => {
    setSelected(account);
    setReason("");
    // Confirming a locked account is a separate, deliberate act each time, so
    // it never carries over from whatever was selected before.
    setAllowLocked(false);
    setReleaseLeaderboard(mayTouchLeaderboard);
    setError("");
    setResult(null);
  };

  const unlink = async () => {
    if (!selected) return;
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setError("Say why this account is being unlinked — it is the only record of the decision.");
      return;
    }
    if (selected.locked && !allowLocked) {
      setError("This account is locked to an approved roster. Tick the confirmation to unlink it anyway.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const outcome = await unlinkGameAccount({
        accountId: selected.id,
        reason: trimmed,
        // The identity that was on screen. A row renamed or replaced since the
        // search refuses rather than being unlinked on a stale view.
        expectedRiotId: selected.riotId,
        allowLocked,
        releaseLeaderboard: releaseLeaderboard && mayTouchLeaderboard,
      });
      setResult(outcome);
      setSelected(null);
      setResults((current) => (current ?? []).filter((account) => account.id !== selected.id));
      setReason("");
    } catch (reasonForFailure) {
      setError(reasonForFailure instanceof Error ? reasonForFailure.message : "That account was not unlinked.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Card className="p-5">
        <p className="text-sm leading-6 text-slate-400">
          When a player is told{" "}
          <em className="text-slate-300">&ldquo;that account is already linked to another Quest
          account&rdquo;</em>, this is the page that answers it. Unlinking releases the account so
          somebody else can connect it — it does not hand it to anyone; they connect it themselves
          through the normal flow.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Approved rosters keep what they recorded: the Riot ID, tag and verification level a team
          registered with are stored on the registration itself and survive an unlink. The decision
          and the previous holder are written to the audit log.
        </p>
      </Card>

      <Card className="p-5">
        <form className="grid gap-3" onSubmit={search}>
          <label className="text-xs uppercase tracking-[0.15em] text-slate-500" htmlFor="account-search">
            Riot ID, player ID, or name
          </label>
          <div className="flex flex-wrap gap-3">
            <Input
              id="account-search"
              className="min-w-[16rem] flex-1"
              placeholder="Sheeno#LK1 · QPID-000042 · sheeno"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={searching || query.trim().length < 2}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            A full <strong className="text-slate-400">Name#Tag</strong> matches exactly. Anything else
            matches Riot names, player display names, Quest usernames and Discord usernames.
          </p>
        </form>
      </Card>

      {error ? (
        <p className="border border-rose-300/20 bg-rose-400/8 p-3 text-sm text-rose-100" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <Card className="border-emerald-300/20 bg-emerald-400/[.06] p-5" role="status">
          <h3 className="text-white">
            {result.released.riotId ?? "That account"} is released
          </h3>
          <p className="mt-2 text-sm leading-6 text-emerald-100/80">
            It was held by {holderLine(result.released.previousHolder)}. Anyone can now connect it
            from their own profile.
          </p>
          <ul className="mt-3 grid gap-1 text-sm text-emerald-100/70">
            {result.released.registrationSnapshots > 0 ? (
              <li>
                {result.released.registrationSnapshots} roster
                {result.released.registrationSnapshots === 1 ? "" : "s"} kept what they registered
                with.
              </li>
            ) : null}
            {result.changeRequestsClosed > 0 ? (
              <li>
                {result.changeRequestsClosed} pending change request
                {result.changeRequestsClosed === 1 ? " was" : "s were"} closed — the player sees why.
              </li>
            ) : null}
            {result.rankingsCleared > 0 ? <li>Their cached profile rank was cleared.</li> : null}
            {leaderboardMessage(result.leaderboard) ? (
              <li
                className={
                  result.leaderboard?.state === "removed" ? undefined : "text-amber-100"
                }
              >
                {leaderboardMessage(result.leaderboard)}
              </li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {results && results.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-slate-400">
            No account matches that. A Riot ID has to be the one stored on the account — if the
            player renamed on Riot, search their Quest name or Discord instead.
          </p>
        </Card>
      ) : null}

      {results && results.length > 0 ? (
        <div className="grid gap-4">
          {results.map((account) => {
            const open = selected?.id === account.id;
            return (
              <Card key={account.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg text-white">{account.riotId ?? "Unnamed account"}</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      Held by {holderLine(account.player)}
                      {account.player.publicId ? ` · ${account.player.publicId}` : ""}
                    </p>
                    {account.player.discord?.username ? (
                      <p className="mt-1 text-sm text-slate-400">
                        Discord: {account.player.discord.username}
                      </p>
                    ) : null}
                    {!account.player.hasQuestAccount ? (
                      <p className="mt-1 text-sm text-amber-200/80">
                        No Quest account behind this player record — staff are the only way to move
                        it.
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {accountStatusLabel(account.status)}
                    </span>
                    <p className="mt-1 text-xs text-slate-500">
                      Linked {new Date(account.linkedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>Verification: {account.verificationStatus.replace(/_/g, " ")}</span>
                  <span>
                    {account.registrationSnapshots} roster
                    {account.registrationSnapshots === 1 ? "" : "s"}
                  </span>
                  <span>ID {account.externalIdFingerprint}</span>
                </div>

                {open ? (
                  <div className="mt-5 grid gap-3 border-t border-white/8 pt-5">
                    <label
                      className="text-xs uppercase tracking-[0.15em] text-slate-500"
                      htmlFor={`unlink-reason-${account.id}`}
                    >
                      Why is this being unlinked? (required)
                    </label>
                    <Textarea
                      id={`unlink-reason-${account.id}`}
                      rows={2}
                      placeholder="Account changed hands; previous holder confirmed in #support on 29 Sep."
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />

                    {account.locked ? (
                      <label className="flex items-start gap-3 border border-amber-300/20 bg-amber-400/[.06] p-3 text-sm text-amber-100">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={allowLocked}
                          onChange={(event) => setAllowLocked(event.target.checked)}
                        />
                        <span>
                          This account is locked to an approved tournament roster, which may still be
                          running. Unlink it anyway.
                        </span>
                      </label>
                    ) : null}

                    {mayTouchLeaderboard ? (
                      <label className="flex items-start gap-3 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={releaseLeaderboard}
                          onChange={(event) => setReleaseLeaderboard(event.target.checked)}
                        />
                        <span>
                          Also remove their VALORANT leaderboard registration. Leave this on unless
                          the old holder should stay on the board — otherwise the board keeps naming
                          them and the next person to connect the account is told they registered
                          when they did not. The removal can be undone.
                        </span>
                      </label>
                    ) : (
                      <p className="text-xs leading-5 text-slate-500">
                        Their leaderboard registration will be left alone — removing it needs the
                        VALORANT leaderboard area. Ask someone who has it, or the board keeps naming
                        the old holder.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3">
                      <Button type="button" variant="secondary" disabled={busy} onClick={() => void unlink()}>
                        {busy ? "Unlinking…" : `Unlink ${account.riotId ?? "this account"}`}
                      </Button>
                      <Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>
                        Cancel
                      </Button>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      This cannot be undone from here. The account becomes claimable immediately, and
                      whoever connects it next goes through the usual Riot ID confirmation.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <Button type="button" size="sm" variant="ghost" onClick={() => select(account)}>
                      Unlink this account
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
