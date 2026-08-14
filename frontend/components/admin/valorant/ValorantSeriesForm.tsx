"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useValorantBindings } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { isoToSriLankaDateTimeLocal, sriLankaDateTimeLocalToIso } from "@/lib/date-time";
import {
  parseRiotIdInput,
  type Binding,
  type ValorantFormat,
  type ValorantRatingMode,
} from "@/lib/valorant";
import { createValorantSeries } from "@/lib/valorant-api";

const bindingLabel = (binding: Binding) =>
  binding.savedTeam
    ? `${binding.savedTeam.name}${binding.savedTeam.teamTag ? ` (${binding.savedTeam.teamTag})` : ""}`
    : "Unnamed team";

export default function ValorantSeriesForm() {
  const router = useRouter();
  const showToast = useToastStore((state) => state.showToast);
  const bindingsQuery = useValorantBindings();

  const [bindingTeamAId, setBindingTeamAId] = useState("");
  const [bindingTeamBId, setBindingTeamBId] = useState("");
  const [format, setFormat] = useState<ValorantFormat>("bo3");
  const [playedAt, setPlayedAt] = useState(() => isoToSriLankaDateTimeLocal(new Date().toISOString()));
  const [ratingModePreference, setRatingModePreference] = useState<ValorantRatingMode>("normal");
  const [anchorPlayerA, setAnchorPlayerA] = useState("");
  const [anchorPlayerB, setAnchorPlayerB] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const activeBindings = (bindingsQuery.data?.bindings ?? []).filter((binding) => binding.status === "active");
  const teamBOptions = activeBindings.filter((binding) => binding.id !== bindingTeamAId);

  const anchorA = parseRiotIdInput(anchorPlayerA);
  const anchorB = parseRiotIdInput(anchorPlayerB);
  const sameTeam = Boolean(bindingTeamAId) && bindingTeamAId === bindingTeamBId;
  const canSubmit =
    !submitting &&
    activeBindings.length >= 2 &&
    Boolean(bindingTeamAId) &&
    Boolean(bindingTeamBId) &&
    !sameTeam &&
    playedAt.trim() !== "" &&
    anchorA !== null &&
    anchorB !== null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedA = parseRiotIdInput(anchorPlayerA);
    const parsedB = parseRiotIdInput(anchorPlayerB);
    if (
      !bindingTeamAId ||
      !bindingTeamBId ||
      bindingTeamAId === bindingTeamBId ||
      playedAt.trim() === "" ||
      !parsedA ||
      !parsedB ||
      submitting
    ) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await createValorantSeries({
        bindingTeamAId,
        bindingTeamBId,
        format,
        playedAt: sriLankaDateTimeLocalToIso(playedAt),
        ratingModePreference,
        anchorPlayerA: parsedA,
        anchorPlayerB: parsedB,
      });
      showToast({ title: "Draft series created", tone: "success" });
      router.push(`/admin/valorant/series/${result.series.id}`);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Could not create the draft series.";
      setError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminShell
      title="New VALORANT Series"
      description="Create a standalone BO1/BO3/BO5 draft series between two bound teams."
    >
      {bindingsQuery.error ? (
        <ValorantErrorAlert message={bindingsQuery.error} onRetry={() => void bindingsQuery.refetch()} />
      ) : (
        <Card className="p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-white">Draft series</h3>
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
                  onChange={(event) => setBindingTeamBId(event.target.value)}
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid min-w-0 gap-2">
                <label htmlFor="anchor-player-a" className="text-sm font-medium text-slate-300">
                  Anchor player A
                </label>
                <Input
                  id="anchor-player-a"
                  aria-label="Anchor player A Riot ID"
                  placeholder="Name#Tag"
                  value={anchorPlayerA}
                  onChange={(event) => setAnchorPlayerA(event.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                />
                {anchorPlayerA.trim() !== "" && anchorA === null ? (
                  <p className="text-xs text-red-300">Enter the Riot ID as Name#Tag.</p>
                ) : null}
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor="anchor-player-b" className="text-sm font-medium text-slate-300">
                  Anchor player B
                </label>
                <Input
                  id="anchor-player-b"
                  aria-label="Anchor player B Riot ID"
                  placeholder="Name#Tag"
                  value={anchorPlayerB}
                  onChange={(event) => setAnchorPlayerB(event.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                />
                {anchorPlayerB.trim() !== "" && anchorB === null ? (
                  <p className="text-xs text-red-300">Enter the Riot ID as Name#Tag.</p>
                ) : null}
              </div>
            </div>

            <div>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? "Creating…" : "Create draft series"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </AdminShell>
  );
}
