"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  listChangeRequests,
  reviewChangeRequest,
  statusLabel,
  type ChangeRequestStatus,
  type GameAccountChangeRequest,
} from "@/lib/game-account-admin";

const FILTERS: { value: ChangeRequestStatus | "all"; label: string }[] = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export default function AdminGameAccountChanges() {
  const [filter, setFilter] = useState<ChangeRequestStatus | "all">("pending");
  const [requests, setRequests] = useState<GameAccountChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await listChangeRequests(filter));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load account change requests.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (request: GameAccountChangeRequest, approve: boolean) => {
    const note = (notes[request.id] || "").trim();
    // The server refuses a rejection without a reason; saying so here avoids a
    // round trip and tells the admin what the player will actually see.
    if (!approve && !note) {
      setError("Give a reason when rejecting — the player sees it.");
      return;
    }
    setPendingId(request.id);
    setError("");
    setNotice("");
    try {
      await reviewChangeRequest({ requestId: request.id, approve, adminNote: note });
      setNotice(
        approve
          ? `Approved. ${request.requestedIdentity} is now the active account.`
          : "Rejected. The player keeps their existing account.",
      );
      setNotes((current) => ({ ...current, [request.id]: "" }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review this request.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <AdminShell
      title="Game account changes"
      description="Review players asking to move their competitive identity to a different game account."
    >
      <div className="grid gap-6">
        <Card className="p-5">
          <p className="text-sm leading-6 text-slate-400">
            A Riot <strong className="text-slate-200">rename</strong> never appears here — the
            underlying account is unchanged, so the display name refreshes on its own. These are
            requests to move to a <strong className="text-slate-200">different account</strong>,
            which affects tournament history and needs a human decision.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((entry) => (
              <Button
                key={entry.value}
                type="button"
                size="sm"
                variant={filter === entry.value ? "secondary" : "ghost"}
                onClick={() => setFilter(entry.value)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </Card>

        {notice ? (
          <p className="border border-emerald-300/20 bg-emerald-400/8 p-3 text-sm text-emerald-100" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="border border-rose-300/20 bg-rose-400/8 p-3 text-sm text-rose-100" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400" role="status">Loading requests…</p>
        ) : error && requests.length === 0 ? (
          // Never show "nothing to review" next to a load failure: an empty
          // queue and a broken one look identical, and one of them means work
          // is silently piling up.
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-400">The queue could not be loaded.</p>
              <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </Card>
        ) : requests.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-slate-400">
              {filter === "pending"
                ? "Nothing awaiting review."
                : "No requests match this filter."}
            </p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {requests.map((request) => {
              const busy = pendingId === request.id;
              const open = request.status === "pending";
              return (
                <Card key={request.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">
                        {request.player?.publicId ?? "Unclaimed player"}
                      </p>
                      <h3 className="mt-1 text-lg text-white">
                        {request.player?.displayName ?? "Unknown player"}
                      </h3>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {statusLabel(request.status)}
                    </span>
                  </div>

                  {/* The whole decision is "is this a different account, and
                      should it be". Showing both sides is the point. */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="border border-white/8 bg-white/[.02] p-3">
                      <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Currently</p>
                      <p className="mt-1 text-white">{request.currentIdentity ?? "—"}</p>
                    </div>
                    <div className="border border-cyan-300/20 bg-cyan-400/[.05] p-3">
                      <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Requested</p>
                      <p className="mt-1 text-white">{request.requestedIdentity}</p>
                      {request.requestedRegion ? (
                        <p className="mt-1 text-xs text-slate-500">Region: {request.requestedRegion}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Player&rsquo;s reason</p>
                    <p className="mt-1 text-sm leading-6 text-slate-300">{request.reason}</p>
                  </div>

                  {open ? (
                    <div className="mt-5 grid gap-3">
                      <label className="text-xs uppercase tracking-[0.15em] text-slate-500" htmlFor={`note-${request.id}`}>
                        Note to the player (required to reject)
                      </label>
                      <Textarea
                        id={`note-${request.id}`}
                        rows={2}
                        value={notes[request.id] || ""}
                        onChange={(event) =>
                          setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                        }
                      />
                      <div className="flex flex-wrap gap-3">
                        <Button type="button" variant="secondary" disabled={busy} onClick={() => void review(request, true)}>
                          {busy ? "Working…" : "Approve change"}
                        </Button>
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => void review(request, false)}>
                          Reject
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        Approving retires the old account rather than deleting it, so existing
                        tournament records keep pointing at what was actually played.
                      </p>
                    </div>
                  ) : request.adminNote ? (
                    <div className="mt-4 border-t border-white/8 pt-4">
                      <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Decision note</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{request.adminNote}</p>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
