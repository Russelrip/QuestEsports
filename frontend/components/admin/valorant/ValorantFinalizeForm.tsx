"use client";

import { useState } from "react";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToastStore } from "@/hooks/useToastStore";
import { ApiRequestError } from "@/lib/api";
import {
  REQUIRES_REASON_RATING_MODES,
  ratingModeLabel,
  type FinalizeResult,
  type ValorantRatingMode,
} from "@/lib/valorant";
import { finalizeValorantSeries } from "@/lib/valorant-api";

export default function ValorantFinalizeForm({
  seriesId,
  teamALabel,
  teamBLabel,
  teamAId,
  teamBId,
  calculatedWinnerId,
  onFinalized,
  onAlreadyFinalized,
}: {
  seriesId: string;
  teamALabel: string;
  teamBLabel: string;
  teamAId: string;
  teamBId: string;
  calculatedWinnerId: string | null;
  onFinalized: (result: FinalizeResult) => Promise<void>;
  onAlreadyFinalized?: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [ratingMode, setRatingMode] = useState<ValorantRatingMode>("normal");
  const [officialWinnerTeamId, setOfficialWinnerTeamId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const requiresReason = REQUIRES_REASON_RATING_MODES.has(ratingMode);
  const reasonMissing = requiresReason && overrideReason.trim() === "";
  const overrideNote =
    officialWinnerTeamId !== null && officialWinnerTeamId !== calculatedWinnerId;

  const handleWinnerChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value === "" ? null : event.target.value;
    setOfficialWinnerTeamId(next);
    if (ratingMode === "normal" && next !== null && next !== calculatedWinnerId) {
      setRatingMode("manual_override");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || reasonMissing) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await finalizeValorantSeries(seriesId, {
        ratingMode,
        officialWinnerTeamId: officialWinnerTeamId ?? null,
        overrideReason: overrideReason.trim() || null,
      });
      await onFinalized(result);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Could not finalize this series.";
      const hints: string[] = [];
      if (message.includes("ANCHOR_MISMATCH")) {
        hints.push("Override requires an explicit rated mode and a reason.");
      }
      if (message.includes("BACKDATED_SERIES_REJECTED")) {
        hints.push("Create a new series with a later played-at date; backdating is not allowed.");
      }
      if (message.includes("RATING_POLICY_REQUIRED")) {
        hints.push("Choose an explicit rating policy and provide a reason.");
      }
      if (message.includes("SERIES_ALREADY_FINALIZED")) {
        hints.push("This series is already committed.");
        onAlreadyFinalized?.();
      }
      if (submitError instanceof ApiRequestError && (submitError.status === 0 || submitError.status === 408)) {
        hints.push(
          "The platform did not confirm the result — use Re-check status to read the current state."
        );
        onAlreadyFinalized?.();
      }
      setError(hints.length > 0 ? `${message} ${hints.join(" ")}` : message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-white">Finalize this series</h3>
      {error ? (
        <div className="mt-4">
          <ValorantErrorAlert message={error} />
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 grid gap-5">
        <div className="grid gap-2">
          <span className="text-sm font-medium text-slate-300">Rating mode</span>
          <div className="grid gap-2">
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="ratingMode"
                value="normal"
                checked={ratingMode === "normal"}
                onChange={() => setRatingMode("normal")}
                disabled={submitting}
              />
              <span>{ratingModeLabel("normal")} — applies ELO and standings counters.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="ratingMode"
                value="unrated"
                checked={ratingMode === "unrated"}
                onChange={() => setRatingMode("unrated")}
                disabled={submitting}
              />
              <span>{ratingModeLabel("unrated")} — result recorded, no ELO, no counters.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="ratingMode"
                value="forfeit_result_only"
                checked={ratingMode === "forfeit_result_only"}
                onChange={() => setRatingMode("forfeit_result_only")}
                disabled={submitting}
              />
              <span>
                {ratingModeLabel("forfeit_result_only")} — official result counts, no ELO.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="ratingMode"
                value="forfeit_no_rating"
                checked={ratingMode === "forfeit_no_rating"}
                onChange={() => setRatingMode("forfeit_no_rating")}
                disabled={submitting}
              />
              <span>
                {ratingModeLabel("forfeit_no_rating")} — result recorded, nothing counts.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="radio"
                name="ratingMode"
                value="manual_override"
                checked={ratingMode === "manual_override"}
                onChange={() => setRatingMode("manual_override")}
                disabled={submitting}
              />
              <span>
                {ratingModeLabel("manual_override")} — ELO applied to the official winner you
                choose.
              </span>
            </label>
          </div>
        </div>

        <div className="grid min-w-0 gap-2">
          <label htmlFor="official-winner" className="text-sm font-medium text-slate-300">
            Official winner
          </label>
          <Select
            id="official-winner"
            aria-label="Official winner"
            value={officialWinnerTeamId ?? ""}
            onChange={handleWinnerChange}
            disabled={submitting}
          >
            <option value="">Calculated winner (auto)</option>
            <option value={teamAId}>{teamALabel}</option>
            <option value={teamBId}>{teamBLabel}</option>
          </Select>
          {overrideNote ? (
            <p className="text-xs text-amber-200/90">
              You chose a different official winner — this is a manual override.
            </p>
          ) : null}
        </div>

        {requiresReason ? (
          <div className="grid min-w-0 gap-2">
            <label htmlFor="override-reason" className="text-sm font-medium text-slate-300">
              Reason for this policy
            </label>
            <Textarea
              id="override-reason"
              aria-label="Reason for this policy (required)"
              placeholder="Required for this rating policy"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              disabled={submitting}
            />
            {reasonMissing ? (
              <p role="alert" className="text-xs text-red-300">
                A reason is required for this rating policy.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2">
          <div>
            <Button type="submit" disabled={submitting || reasonMissing}>
              {submitting ? "Finalizing…" : "Finalize series"}
            </Button>
          </div>
          {submitting ? (
            <p role="status" className="text-xs text-slate-500">
              This action cannot be retried automatically — wait for the result.
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
