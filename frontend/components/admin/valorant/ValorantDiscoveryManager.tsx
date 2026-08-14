"use client";

import { useRef, useState } from "react";
import ValorantCandidateList from "@/components/admin/valorant/ValorantCandidateList";
import ValorantCandidateReview from "@/components/admin/valorant/ValorantCandidateReview";
import ValorantDiscoveryForm from "@/components/admin/valorant/ValorantDiscoveryForm";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { useDialogFocus } from "@/components/admin/valorant/useDialogFocus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToastStore } from "@/hooks/useToastStore";
import { formatRiotId, type MatchCandidate, type MatchDetail, type ResolvedPlayer, type RiotId } from "@/lib/valorant";
import { discoverValorant } from "@/lib/valorant-api";

type SearchInput = {
  playerA: RiotId;
  playerB: RiotId;
  pageSize: number;
  maxPages: number;
  map?: string;
  from?: string;
};

export default function ValorantDiscoveryManager() {
  const showToast = useToastStore((state) => state.showToast);
  const lastSearchRef = useRef<SearchInput | null>(null);
  const [players, setPlayers] = useState<{ a: ResolvedPlayer; b: ResolvedPlayer } | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [selected, setSelected] = useState<MatchCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedConfirmation, setImportedConfirmation] = useState<string | null>(null);
  const handleCloseReview = () => setSelected(null);
  const reviewDialogRef = useDialogFocus({ onClose: handleCloseReview, open: selected !== null });

  const handleSearch = async (input: SearchInput) => {
    lastSearchRef.current = input;
    setLoading(true);
    setError(null);
    setImportedConfirmation(null);
    setSelected(null);
    try {
      const response = await discoverValorant(input);
      setPlayers(response.players);
      setCandidates(response.candidates);
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : "Discovery failed.";
      setPlayers(null);
      setCandidates([]);
      setError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    if (lastSearchRef.current) void handleSearch(lastSearchRef.current);
  };

  const handleImported = (detail: MatchDetail, created: boolean) => {
    setImportedConfirmation("Match imported — you can attach it from the Series screen.");
    showToast({ title: created ? "Match imported" : "Match already imported", tone: created ? "success" : "info" });
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.henrikMatchId === detail.henrikMatchId ? { ...candidate, alreadyImported: true } : candidate
      )
    );
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div>
        <h3 className="text-lg font-semibold text-white">Match Discovery</h3>
        <p className="text-sm text-slate-400">
          Find matches two players have shared, review the candidates, and import the right one explicitly.
        </p>
      </div>

      <ValorantDiscoveryForm onSearch={handleSearch} loading={loading} />

      <div className="min-w-0 overflow-x-auto">
        {loading ? (
          <ValorantLoadingState />
        ) : error ? (
          <ValorantErrorAlert message={error} onRetry={handleRetry} />
        ) : players ? (
          <>
            <Card className="p-5">
              <div className="grid gap-1 text-sm text-slate-300">
                <p>
                  Player A: {formatRiotId(players.a)} ({players.a.affinity})
                </p>
                <p>
                  Player B: {formatRiotId(players.b)} ({players.b.affinity})
                </p>
              </div>
            </Card>
            {candidates.length === 0 ? (
              <ValorantEmptyState
                title="No matches found for these two players"
                description="Try different Riot IDs, filters, or a wider date range."
              />
            ) : (
              <ValorantCandidateList candidates={candidates} onSelect={setSelected} />
            )}
          </>
        ) : null}
      </div>

      {importedConfirmation ? (
        <Card role="status" className="border-emerald-300/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
          {importedConfirmation}
        </Card>
      ) : null}

      {selected ? (
        <div
          ref={reviewDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Review candidate match"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-10"
          onClick={handleCloseReview}
        >
          <div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
            <ValorantCandidateReview
              candidate={selected}
              players={players}
              onClose={handleCloseReview}
              onImported={handleImported}
            />
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={handleCloseReview}>
                Close dialog
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
