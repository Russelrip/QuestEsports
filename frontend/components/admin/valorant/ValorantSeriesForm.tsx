"use client";

import { useEffect, useState } from "react";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAdminTournamentOptions } from "@/hooks/api/useAdmin";
import { useValorantBindings } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { isoToSriLankaDateTimeLocal, sriLankaDateTimeLocalToIso } from "@/lib/date-time";
import {
  mapsForFormat,
  parseStoredRiotId,
  type Binding,
  type ValorantFormat,
  type ValorantRatingMode,
} from "@/lib/valorant";
import {
  createManualValorantSeries,
  createValorantSeries,
  fetchAdminTeamMembers,
  type AdminTeamMember,
} from "@/lib/valorant-api";

const bindingLabel = (binding: Binding) =>
  binding.savedTeam
    ? `${binding.savedTeam.name}${binding.savedTeam.teamTag ? ` (${binding.savedTeam.teamTag})` : ""}`
    : "Unnamed team";

const winningScoresByFormat: Record<ValorantFormat, string> = {
  bo1: "1–0",
  bo3: "2–0 or 2–1",
  bo5: "3–0, 3–1, or 3–2",
};

export default function ValorantSeriesForm({
  onCreated,
  onCancel,
}: {
  onCreated: (seriesId: string) => void;
  onCancel?: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const bindingsQuery = useValorantBindings();
  const tournamentsQuery = useAdminTournamentOptions();

  const [bindingTeamAId, setBindingTeamAId] = useState("");
  const [bindingTeamBId, setBindingTeamBId] = useState("");
  const [format, setFormat] = useState<ValorantFormat>("bo3");
  const [playedAt, setPlayedAt] = useState(() => isoToSriLankaDateTimeLocal(new Date().toISOString()));
  const [ratingModePreference, setRatingModePreference] = useState<ValorantRatingMode>("normal");
  const [seriesType, setSeriesType] = useState<"discovered" | "manual">("discovered");
  const [manualRatingMode, setManualRatingMode] = useState<ValorantRatingMode>("normal");
  const [winnerIsA, setWinnerIsA] = useState(true);
  const [teamAMapsWon, setTeamAMapsWon] = useState(0);
  const [teamBMapsWon, setTeamBMapsWon] = useState(0);
  const [tournamentId, setTournamentId] = useState("");
  const [anchorMemberAId, setAnchorMemberAId] = useState("");
  const [anchorMemberBId, setAnchorMemberBId] = useState("");
  const [teamAMembers, setTeamAMembers] = useState<AdminTeamMember[]>([]);
  const [teamBMembers, setTeamBMembers] = useState<AdminTeamMember[]>([]);
  const [teamAMembersLoading, setTeamAMembersLoading] = useState(false);
  const [teamBMembersLoading, setTeamBMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const activeBindings = (bindingsQuery.data?.bindings ?? []).filter((binding) => binding.status === "active");
  const teamBOptions = activeBindings.filter((binding) => binding.id !== bindingTeamAId);
  const tournamentOptions = tournamentsQuery.data ?? [];

  const teamAMembersWithRiotId = teamAMembers.filter((member) => member.riotId && member.riotId.trim() !== "");
  const teamBMembersWithRiotId = teamBMembers.filter((member) => member.riotId && member.riotId.trim() !== "");

  const anchorAMember = teamAMembers.find((member) => member.id === anchorMemberAId) ?? null;
  const anchorBMember = teamBMembers.find((member) => member.id === anchorMemberBId) ?? null;
  const anchorA = anchorAMember ? parseStoredRiotId(anchorAMember.riotId ?? "") : null;
  const anchorB = anchorBMember ? parseStoredRiotId(anchorBMember.riotId ?? "") : null;
  const sameTeam = Boolean(bindingTeamAId) && bindingTeamAId === bindingTeamBId;

  const isManual = seriesType === "manual";

  // Manual series require an explicit played-at time — entering manual mode
  // clears the "now" convenience default. Discovered mode keeps the default.
  const handleSeriesTypeChange = (next: "discovered" | "manual") => {
    setSeriesType(next);
    if (next === "manual") {
      setPlayedAt("");
    } else if (playedAt.trim() === "") {
      setPlayedAt(isoToSriLankaDateTimeLocal(new Date().toISOString()));
    }
  };

  const mapsNeededToWin = Math.ceil(mapsForFormat(format) / 2);
  const mapsDecisive = teamAMapsWon !== teamBMapsWon;
  const mapsReachWin = Math.max(teamAMapsWon, teamBMapsWon) === mapsNeededToWin;
  const winnerMatchesMaps = winnerIsA ? teamAMapsWon > teamBMapsWon : teamBMapsWon > teamAMapsWon;
  const manualResultValid = mapsDecisive && mapsReachWin && winnerMatchesMaps;
  const manualResultHint = !mapsDecisive
    ? "The winner must have more maps than the loser."
    : !mapsReachWin
      ? `${format.toUpperCase()} is played to ${mapsNeededToWin} map${mapsNeededToWin === 1 ? "" : "s"} — the winner's score must be ${winningScoresByFormat[format]}.`
      : "The selected winner must be the team with more maps won.";

  const canSubmit =
    !submitting &&
    activeBindings.length >= 2 &&
    Boolean(bindingTeamAId) &&
    Boolean(bindingTeamBId) &&
    !sameTeam &&
    playedAt.trim() !== "" &&
    (isManual ? manualResultValid : anchorA !== null && anchorB !== null);

  // Once a team binding is selected, load its roster so the anchor dropdown lists
  // the members that carry a Riot ID.
  useEffect(() => {
    const bindings = bindingsQuery.data?.bindings ?? [];
    const binding = bindings.find((candidate) => candidate.id === bindingTeamAId);
    const teamId = binding?.savedTeamId ?? "";
    if (!teamId) {
      setTeamAMembers([]);
      setTeamAMembersLoading(false);
      return;
    }
    let active = true;
    setTeamAMembersLoading(true);
    setMembersError("");
    void fetchAdminTeamMembers(teamId)
      .then((members) => {
        if (active) setTeamAMembers(members);
      })
      .catch((loadError) => {
        if (active) {
          setMembersError(
            loadError instanceof Error ? loadError.message : "Could not load team members."
          );
        }
      })
      .finally(() => {
        if (active) setTeamAMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bindingTeamAId, bindingsQuery.data]);

  useEffect(() => {
    const bindings = bindingsQuery.data?.bindings ?? [];
    const binding = bindings.find((candidate) => candidate.id === bindingTeamBId);
    const teamId = binding?.savedTeamId ?? "";
    if (!teamId) {
      setTeamBMembers([]);
      setTeamBMembersLoading(false);
      return;
    }
    let active = true;
    setTeamBMembersLoading(true);
    setMembersError("");
    void fetchAdminTeamMembers(teamId)
      .then((members) => {
        if (active) setTeamBMembers(members);
      })
      .catch((loadError) => {
        if (active) {
          setMembersError(
            loadError instanceof Error ? loadError.message : "Could not load team members."
          );
        }
      })
      .finally(() => {
        if (active) setTeamBMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bindingTeamBId, bindingsQuery.data]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !bindingTeamAId ||
      !bindingTeamBId ||
      bindingTeamAId === bindingTeamBId ||
      playedAt.trim() === "" ||
      submitting ||
      (isManual ? !manualResultValid : !anchorA || !anchorB)
    ) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (isManual) {
        const result = await createManualValorantSeries({
          bindingTeamAId,
          bindingTeamBId,
          format,
          playedAt: sriLankaDateTimeLocalToIso(playedAt),
          ratingMode: manualRatingMode,
          winnerTeamId: winnerIsA ? bindingTeamAId : bindingTeamBId,
          teamAMapsWon,
          teamBMapsWon,
          tournamentId: tournamentId || null,
        });
        showToast({ title: "Manual series finalized", tone: "success" });
        onCreated(result.series.id);
      } else {
        // Re-narrow the anchor Riot IDs for this branch (TS cannot carry the
        // ternary guard above into the discovered path).
        if (!anchorA || !anchorB) return;
        const result = await createValorantSeries({
          bindingTeamAId,
          bindingTeamBId,
          format,
          playedAt: sriLankaDateTimeLocalToIso(playedAt),
          ratingModePreference,
          anchorPlayerA: anchorA,
          anchorPlayerB: anchorB,
          tournamentId: tournamentId || null,
        });
        showToast({ title: "Draft series created", tone: "success" });
        onCreated(result.series.id);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Could not create the series.";
      setError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">New VALORANT Series</h3>
          <p className="text-sm text-slate-400">
            {isManual
              ? "Create and finalize a BO1/BO3/BO5 manual-result series — the winner and map counts are recorded immediately."
              : "Create a standalone BO1/BO3/BO5 draft series between two bound teams."}
          </p>
        </div>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Back to series
          </Button>
        ) : null}
      </div>

      {bindingsQuery.error ? (
        <ValorantErrorAlert message={bindingsQuery.error} onRetry={() => void bindingsQuery.refetch()} />
      ) : (
        <Card className="p-5 sm:p-6">
          <h4 className="text-lg font-semibold text-white">{isManual ? "Manual result series" : "Draft series"}</h4>
          {error ? <ValorantErrorAlert message={error} /> : null}
          {!bindingsQuery.loading && activeBindings.length < 2 ? (
            <p role="alert" className="mt-3 text-sm text-red-300">
              Both teams must have an active VALORANT binding
            </p>
          ) : null}
          {!bindingsQuery.loading && sameTeam ? (
            <p role="alert" className="mt-3 text-sm text-red-300">
              Team A and Team B must be different teams.
            </p>
          ) : null}
          <form onSubmit={handleSubmit} className="mt-4 grid gap-5">
            <div className="grid min-w-0 gap-2">
              <span className="text-sm font-medium text-slate-300">Series type</span>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="radio"
                    name="seriesType"
                    value="discovered"
                    checked={seriesType === "discovered"}
                    onChange={() => handleSeriesTypeChange("discovered")}
                    disabled={submitting}
                  />
                  Discovered
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="radio"
                    name="seriesType"
                    value="manual"
                    checked={seriesType === "manual"}
                    onChange={() => handleSeriesTypeChange("manual")}
                    disabled={submitting}
                  />
                  Manual result
                </label>
              </div>
              <p className="text-xs text-slate-500">
                {isManual
                  ? "Enter the outcome directly — the series is finalized on creation."
                  : "Discover and attach the actual matches, then finalize when complete."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid min-w-0 gap-2">
                <label htmlFor="team-a-binding" className="text-sm font-medium text-slate-300">
                  Team A
                </label>
                <Select
                  id="team-a-binding"
                  aria-label="Team A binding"
                  value={bindingTeamAId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setBindingTeamAId(next);
                    if (bindingTeamBId === next) setBindingTeamBId("");
                    setAnchorMemberAId("");
                  }}
                  disabled={submitting || activeBindings.length === 0}
                >
                  <option value="">Select Team A binding…</option>
                  {activeBindings.map((binding) => (
                    <option key={binding.id} value={binding.id}>
                      {bindingLabel(binding)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor="team-b-binding" className="text-sm font-medium text-slate-300">
                  Team B
                </label>
                <Select
                  id="team-b-binding"
                  aria-label="Team B binding"
                  value={bindingTeamBId}
                  onChange={(event) => {
                    setBindingTeamBId(event.target.value);
                    setAnchorMemberBId("");
                  }}
                  disabled={submitting || teamBOptions.length === 0}
                >
                  <option value="">Select Team B binding…</option>
                  {teamBOptions.map((binding) => (
                    <option key={binding.id} value={binding.id}>
                      {bindingLabel(binding)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid min-w-0 gap-2">
              <span className="text-sm font-medium text-slate-300">Format</span>
              <div className="flex flex-wrap gap-4">
                {(["bo1", "bo3", "bo5"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="format"
                      value={value}
                      checked={format === value}
                      onChange={() => setFormat(value)}
                      disabled={submitting}
                    />
                    {value.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid min-w-0 gap-2">
              <label htmlFor="played-at" className="text-sm font-medium text-slate-300">
                Played at
              </label>
              <Input
                id="played-at"
                type="datetime-local"
                aria-label="Played at"
                value={playedAt}
                onChange={(event) => setPlayedAt(event.target.value)}
                disabled={submitting}
              />
              {playedAt.trim() === "" ? (
                <p role="alert" className="text-xs text-red-300">
                  Enter the played-at time.
                </p>
              ) : (
                <p className="text-xs text-slate-500">Sri Lanka local time.</p>
              )}
            </div>

            <div className="grid min-w-0 gap-2">
              <label htmlFor="series-tournament" className="text-sm font-medium text-slate-300">
                Tournament
              </label>
              <Select
                id="series-tournament"
                aria-label="Tournament"
                value={tournamentId}
                onChange={(event) => setTournamentId(event.target.value)}
                disabled={submitting}
              >
                <option value="">No tournament</option>
                {tournamentOptions.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.title}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                Optional — a series can be created standalone and linked to a tournament later.
              </p>
            </div>

            {isManual ? (
              <div className="grid min-w-0 gap-2">
                <span className="text-sm font-medium text-slate-300">Rating mode</span>
                <div className="grid gap-2">
                  <label className="flex items-start gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="ratingMode"
                      value="normal"
                      checked={manualRatingMode === "normal"}
                      onChange={() => setManualRatingMode("normal")}
                      disabled={submitting}
                    />
                    Rated — applies ELO and counts toward standings
                  </label>
                  <label className="flex items-start gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="ratingMode"
                      value="unrated"
                      checked={manualRatingMode === "unrated"}
                      onChange={() => setManualRatingMode("unrated")}
                      disabled={submitting}
                    />
                    Unrated — result recorded, no ELO, no counters
                  </label>
                </div>
                <p className="text-xs text-slate-500">Applied immediately — the manual series finalizes on creation.</p>
                <p className="text-xs text-slate-500">
                  Historical results apply ELO immediately in entry order — run a rankings rebuild after importing a batch for chronological correctness.
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 gap-2">
                <span className="text-sm font-medium text-slate-300">Rating preference</span>
                <div className="grid gap-2">
                  <label className="flex items-start gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="ratingModePreference"
                      value="normal"
                      checked={ratingModePreference === "normal"}
                      onChange={() => setRatingModePreference("normal")}
                      disabled={submitting}
                    />
                    Rated — applies ELO and counts toward standings
                  </label>
                  <label className="flex items-start gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="ratingModePreference"
                      value="unrated"
                      checked={ratingModePreference === "unrated"}
                      onChange={() => setRatingModePreference("unrated")}
                      disabled={submitting}
                    />
                    Unrated — result recorded, no ELO, no counters
                  </label>
                </div>
                <p className="text-xs text-slate-500">The final decision happens at finalization.</p>
              </div>
            )}

            {!isManual ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-2">
                    <label htmlFor="anchor-player-a" className="text-sm font-medium text-slate-300">
                      Anchor player A
                    </label>
                    <Select
                      id="anchor-player-a"
                      aria-label="Anchor player A"
                      value={anchorMemberAId}
                      onChange={(event) => setAnchorMemberAId(event.target.value)}
                      disabled={submitting || !bindingTeamAId || teamAMembersLoading || teamAMembersWithRiotId.length === 0}
                    >
                      <option value="">
                        {!bindingTeamAId
                          ? "Select a Team A binding first…"
                          : teamAMembersLoading
                            ? "Loading team members…"
                            : teamAMembersWithRiotId.length === 0
                              ? "No members with a Riot ID"
                              : "Select an anchor player…"}
                      </option>
                      {teamAMembersWithRiotId.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} — {member.riotId}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <label htmlFor="anchor-player-b" className="text-sm font-medium text-slate-300">
                      Anchor player B
                    </label>
                    <Select
                      id="anchor-player-b"
                      aria-label="Anchor player B"
                      value={anchorMemberBId}
                      onChange={(event) => setAnchorMemberBId(event.target.value)}
                      disabled={submitting || !bindingTeamBId || teamBMembersLoading || teamBMembersWithRiotId.length === 0}
                    >
                      <option value="">
                        {!bindingTeamBId
                          ? "Select a Team B binding first…"
                          : teamBMembersLoading
                            ? "Loading team members…"
                            : teamBMembersWithRiotId.length === 0
                              ? "No members with a Riot ID"
                              : "Select an anchor player…"}
                      </option>
                      {teamBMembersWithRiotId.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} — {member.riotId}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                {membersError ? (
                  <p role="alert" className="text-sm text-red-300">
                    Could not load anchor players: {membersError}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="grid min-w-0 gap-2">
                  <span className="text-sm font-medium text-slate-300">Winner</span>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="radio"
                        name="winner"
                        value="team-a"
                        checked={winnerIsA}
                        onChange={() => setWinnerIsA(true)}
                        disabled={submitting}
                      />
                      Team A
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="radio"
                        name="winner"
                        value="team-b"
                        checked={!winnerIsA}
                        onChange={() => setWinnerIsA(false)}
                        disabled={submitting}
                      />
                      Team B
                    </label>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-2">
                    <label htmlFor="team-a-maps-won" className="text-sm font-medium text-slate-300">
                      Team A maps won
                    </label>
                    <Input
                      id="team-a-maps-won"
                      type="number"
                      min={0}
                      max={mapsForFormat(format)}
                      aria-label="Team A maps won"
                      value={teamAMapsWon}
                      onChange={(event) => {
                        const next = event.target.value === "" ? 0 : Number(event.target.value);
                        const value = Number.isFinite(next) ? next : 0;
                        setTeamAMapsWon(value);
                        if (value > teamBMapsWon) setWinnerIsA(true);
                        if (value < teamBMapsWon) setWinnerIsA(false);
                      }}
                      disabled={submitting}
                    />
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <label htmlFor="team-b-maps-won" className="text-sm font-medium text-slate-300">
                      Team B maps won
                    </label>
                    <Input
                      id="team-b-maps-won"
                      type="number"
                      min={0}
                      max={mapsForFormat(format)}
                      aria-label="Team B maps won"
                      value={teamBMapsWon}
                      onChange={(event) => {
                        const next = event.target.value === "" ? 0 : Number(event.target.value);
                        const value = Number.isFinite(next) ? next : 0;
                        setTeamBMapsWon(value);
                        if (value > teamAMapsWon) setWinnerIsA(false);
                        if (value < teamAMapsWon) setWinnerIsA(true);
                      }}
                      disabled={submitting}
                    />
                  </div>
                </div>
                {manualResultValid ? (
                  <p className="text-xs text-slate-500">
                    {format.toUpperCase()} is played to {mapsNeededToWin} map{mapsNeededToWin === 1 ? "" : "s"} — winning scores are {winningScoresByFormat[format]}.
                  </p>
                ) : (
                  <p role="alert" className="text-xs text-red-300">
                    {manualResultHint}
                  </p>
                )}
              </>
            )}

            <div>
              <Button type="submit" disabled={!canSubmit}>
                {submitting
                  ? isManual
                    ? "Finalizing…"
                    : "Creating…"
                  : isManual
                    ? "Create & finalize series"
                    : "Create draft series"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
