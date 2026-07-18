"use client";

import { useState } from "react";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToastStore } from "@/hooks/useToastStore";
import {
  type AdminTournamentBracket,
  adminRequest,
} from "@/lib/admin";

export function AssetRemovalCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-white/20 bg-black/30 accent-purple-300"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function BracketAdminPanel({
  tournamentId,
  bracket,
  busy,
  onBusyChange,
  onBracketChange,
}: {
  tournamentId: string;
  bracket: AdminTournamentBracket | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onBracketChange: (bracket: AdminTournamentBracket | null) => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const participants = new Map(
    (bracket?.bracketData.participant || []).map((participant) => [
      participant.id,
      participant,
    ])
  );
  const editableMatches = (bracket?.bracketData.match || []).filter(
    (match) => match.opponent1?.id !== null && match.opponent2?.id !== null
  );

  const runBracketAction = async (
    action: () => Promise<{
      bracket: AdminTournamentBracket | null;
      message?: string;
    }>,
    successTitle: string
  ) => {
    onBusyChange(true);
    try {
      const response = await action();
      onBracketChange(response.bracket);
      showToast({
        tone: "success",
        title: successTitle,
        description: response.message || successTitle,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Bracket action failed.";
      showToast({
        tone: "error",
        title: "Bracket action failed",
        description: message,
      });
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-2xl text-white">Native Bracket</h3>
          <p className="mt-1 text-sm text-slate-400">
            Generate from approved teams, publish it publicly, and update match
            results during the event.
          </p>
          {bracket ? (
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              {bracket.status} - {bracket.summary.completed}/
              {bracket.summary.total} completed
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              runBracketAction(
                () =>
                  adminRequest(
                    `/api/admin/tournaments/${tournamentId}/bracket/generate`,
                    { method: "POST" }
                  ),
                "Bracket generated"
              )
            }
          >
            {busy ? "Working..." : "Generate Bracket"}
          </Button>
          {bracket ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                runBracketAction(
                  () =>
                    adminRequest(
                      `/api/admin/tournaments/${tournamentId}/bracket/publish`,
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          isPublished: bracket.status !== "published",
                        }),
                      }
                    ),
                  bracket.status === "published"
                    ? "Bracket unpublished"
                    : "Bracket published"
                )
              }
            >
              {bracket.status === "published" ? "Unpublish" : "Publish"}
            </Button>
          ) : null}
        </div>
      </div>

      {!bracket ? (
        <EmptyState description="No native bracket has been generated yet." />
      ) : (
        <div className="mt-6 grid gap-4">
          {editableMatches.slice(0, 12).map((match) => (
            <AdminMatchResultForm
              key={match.id}
              tournamentId={tournamentId}
              match={match}
              participantName={(participantId) =>
                participantId === null || participantId === undefined
                  ? "TBD"
                  : participants.get(participantId)?.name || "TBD"
              }
              disabled={busy}
              onBusyChange={onBusyChange}
              onBracketChange={onBracketChange}
            />
          ))}
          {editableMatches.length > 12 ? (
            <p className="text-sm text-slate-400">
              Showing the first 12 editable matches. More matches become easier
              to manage from the bracket view after progression.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function AdminMatchResultForm({
  tournamentId,
  match,
  participantName,
  disabled,
  onBusyChange,
  onBracketChange,
}: {
  tournamentId: string;
  match: AdminTournamentBracket["bracketData"]["match"][number];
  participantName: (participantId: number | null | undefined) => string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onBracketChange: (bracket: AdminTournamentBracket | null) => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [opponent1Score, setOpponent1Score] = useState(
    String(match.opponent1?.score ?? "")
  );
  const [opponent2Score, setOpponent2Score] = useState(
    String(match.opponent2?.score ?? "")
  );
  const opponent1Name = participantName(match.opponent1?.id);
  const opponent2Name = participantName(match.opponent2?.id);

  const submitResult = async (winner: "opponent1" | "opponent2") => {
    onBusyChange(true);
    try {
      const response = await adminRequest<{
        bracket: AdminTournamentBracket;
        message: string;
      }>(`/api/admin/tournaments/${tournamentId}/bracket/matches/${match.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponent1Score, opponent2Score, winner }),
      });
      onBracketChange(response.bracket);
      showToast({
        tone: "success",
        title: "Match updated",
        description: response.message,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update match.";
      showToast({
        tone: "error",
        title: "Unable to update match",
        description: message,
      });
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/5 p-4 xl:grid-cols-[1fr_auto] xl:items-center">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
          Match {match.id + 1}
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-slate-300">
            {opponent1Name}
            <Input
              type="number"
              min="0"
              value={opponent1Score}
              onChange={(event) => setOpponent1Score(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-300">
            {opponent2Name}
            <Input
              type="number"
              min="0"
              value={opponent2Score}
              onChange={(event) => setOpponent2Score(event.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => submitResult("opponent1")}
        >
          {opponent1Name} Wins
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => submitResult("opponent2")}
        >
          {opponent2Name} Wins
        </Button>
      </div>
    </div>
  );
}

export function FileUploadField({
  id,
  accept,
  file,
  existingUrl,
  onChange,
}: {
  id: string;
  accept: string;
  file: File | null;
  existingUrl: string | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <div>
      <Input
        id={id}
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      <p className="mt-2 text-xs text-slate-500">
        {file
          ? file.name
          : existingUrl
            ? "Existing image on file"
            : "No image uploaded yet"}
      </p>
    </div>
  );
}
