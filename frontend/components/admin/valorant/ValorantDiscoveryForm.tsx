"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseRiotIdInput, type RiotId } from "@/lib/valorant";

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 1;

export default function ValorantDiscoveryForm({
  onSearch,
  loading,
}: {
  onSearch: (input: {
    playerA: RiotId;
    playerB: RiotId;
    pageSize: number;
    maxPages: number;
    map?: string;
    from?: string;
  }) => Promise<void>;
  loading: boolean;
}) {
  const [playerAInput, setPlayerAInput] = useState("");
  const [playerBInput, setPlayerBInput] = useState("");
  const [map, setMap] = useState("");
  const [from, setFrom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const playerA = parseRiotIdInput(playerAInput);
    const playerB = parseRiotIdInput(playerBInput);
    if (!playerA || !playerB) {
      setError("Enter both Riot IDs as Name#Tag.");
      return;
    }
    setError(null);
    const input: {
      playerA: RiotId;
      playerB: RiotId;
      pageSize: number;
      maxPages: number;
      map?: string;
      from?: string;
    } = { playerA, playerB, pageSize: DEFAULT_PAGE_SIZE, maxPages: DEFAULT_MAX_PAGES };
    if (map.trim()) input.map = map.trim();
    if (from) input.from = from;
    void onSearch(input);
  };

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-white">Find shared matches</h3>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <label htmlFor="player-a-riot-id" className="text-sm font-medium text-slate-300">
            Player A Riot ID
          </label>
          <Input
            id="player-a-riot-id"
            aria-label="Player A Riot ID"
            placeholder="Name#Tag"
            value={playerAInput}
            onChange={(event) => setPlayerAInput(event.target.value)}
            disabled={loading}
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">e.g. TenZ#SEN</p>
        </div>
        <div className="grid min-w-0 gap-2">
          <label htmlFor="player-b-riot-id" className="text-sm font-medium text-slate-300">
            Player B Riot ID
          </label>
          <Input
            id="player-b-riot-id"
            aria-label="Player B Riot ID"
            placeholder="Name#Tag"
            value={playerBInput}
            onChange={(event) => setPlayerBInput(event.target.value)}
            disabled={loading}
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">e.g. Demon1#NA</p>
        </div>
        <div className="grid min-w-0 gap-2">
          <label htmlFor="map-filter" className="text-sm font-medium text-slate-300">
            Map filter (optional)
          </label>
          <Input
            id="map-filter"
            aria-label="Map filter (optional)"
            placeholder="Ascent"
            value={map}
            onChange={(event) => setMap(event.target.value)}
            disabled={loading}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <label htmlFor="from-date" className="text-sm font-medium text-slate-300">
            From date (optional)
          </label>
          <Input
            id="from-date"
            aria-label="From date (optional)"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            disabled={loading}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search matches"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
