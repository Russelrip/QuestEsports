"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { SeriesGame } from "@/lib/valorant";
import { validateDesiredOrder } from "@/lib/valorant";

export default function ValorantReorderControl({
  games,
  onReorder,
}: {
  games: SeriesGame[];
  onReorder: (order: Array<{ gameId: string; gameNumber: number }>) => Promise<void>;
}) {
  const [numbers, setNumbers] = useState<Record<string, number>>(() =>
    Object.fromEntries(games.map((game) => [game.id, game.gameNumber]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    const values = games.map((game) => numbers[game.id]);
    const validationError = validateDesiredOrder(values, games.length);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onReorder(
        games.map((game) => ({ gameId: game.id, gameNumber: numbers[game.id] }))
      );
    } catch {
      // The parent reports the failure; the control just resets its busy state.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-4">
        {games.map((game) => (
          <div key={game.id} className="grid min-w-0 gap-2">
            <label htmlFor={`map-number-${game.id}`} className="text-xs font-medium text-slate-400">
              Game {game.gameNumber}
            </label>
            <Select
              id={`map-number-${game.id}`}
              aria-label="Map number"
              value={numbers[game.id]}
              onChange={(event) =>
                setNumbers((current) => ({
                  ...current,
                  [game.id]: Number(event.target.value),
                }))
              }
              disabled={submitting}
              className="w-24"
            >
              {Array.from({ length: games.length }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <Button type="button" onClick={handleSave} disabled={submitting}>
          {submitting ? "Saving order…" : "Save order"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        Order is saved as the full desired map order — retrying the same order is safe.
      </p>
    </Card>
  );
}
