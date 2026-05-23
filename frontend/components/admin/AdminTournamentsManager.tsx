"use client";

import Link from "next/link";
import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminTournaments } from "@/hooks/api/useAdmin";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest, getAdminPaginationSummary } from "@/lib/admin";
import { type Tournament, getTournamentRegistrationLabel, getTournamentStatusLabel } from "@/lib/tournaments";

export default function AdminTournamentsManager() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, refetch } = useAdminTournaments(search, status, visibility, page);
  const showToast = useToastStore((state) => state.showToast);

  const tournaments = data?.tournaments || [];
  const pagination = data?.pagination;

  const handleDelete = async (tournamentId: string) => {
    if (!window.confirm("Delete this tournament? This will also remove related registrations.")) {
      return;
    }

    try {
      await adminRequest(`/api/admin/tournaments/${tournamentId}`, { method: "DELETE" });
      showToast({ tone: "success", title: "Tournament deleted" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to delete tournament",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  const handleQuickUpdate = async (
    tournament: Tournament,
    updates: Partial<Pick<Tournament, "status" | "isPublished">>
  ) => {
    try {
      const body = new FormData();
      body.append("title", tournament.title);
      body.append("slug", tournament.slug);
      body.append("game", tournament.game);
      body.append("shortDescription", tournament.shortDescription);
      body.append("fullDescription", tournament.fullDescription);
      body.append("rules", tournament.rules || "");
      body.append("startDate", tournament.startDate);
      body.append("endDate", tournament.endDate);
      body.append("registrationDeadline", tournament.registrationDeadline);
      body.append("format", tournament.format);
      body.append("teamSize", String(tournament.teamSize));
      body.append("maxTeams", String(tournament.maxTeams));
      body.append("prizePool", tournament.prizePool);
      body.append("status", updates.status || tournament.status);
      body.append("isPublished", String(typeof updates.isPublished === "boolean" ? updates.isPublished : tournament.isPublished));
      body.append("isFeatured", String(tournament.isFeatured));
      if (tournament.bracketLink) body.append("bracketLink", tournament.bracketLink);
      if (tournament.contactLink) body.append("contactLink", tournament.contactLink);

      await adminRequest(`/api/admin/tournaments/${tournament.id}`, { method: "PATCH", body });
      showToast({ tone: "success", title: "Tournament updated" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update tournament",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  return (
    <AdminShell
      title="Tournaments"
      description="Create, edit, publish, and manage every tournament from the dashboard."
      actions={<Link href="/admin/tournaments/new" className={buttonClassName({})}>New Tournament</Link>}
    >
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="text-2xl text-white">Tournament List</h3>
            <p className="text-sm text-slate-400">Search and filter tournaments before editing or publishing them.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search title, slug, or game..." />
            <Select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="upcoming">Upcoming</option>
              <option value="registration_open">Registration Open</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Select value={visibility} onChange={(event) => { setPage(1); setVisibility(event.target.value); }}>
              <option value="">All visibility</option>
              <option value="true">Published</option>
              <option value="false">Hidden</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <AdminTableSkeleton />
        ) : error ? (
          <EmptyState description={error} />
        ) : tournaments.length === 0 ? (
          <EmptyState description="No tournaments matched your current search or filters." />
        ) : (
          <div className="grid gap-4">
            {tournaments.map((tournament) => (
              <div key={tournament.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/5 p-5 xl:grid-cols-[1.1fr_0.8fr_auto] xl:items-center">
                <div>
                  <p className="font-semibold text-white">{tournament.title}</p>
                  <p className="text-sm text-slate-400">{tournament.slug} · {tournament.game}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                    <span className="rounded-full border border-white/8 bg-black/20 px-3 py-1">{getTournamentStatusLabel(tournament.status)}</span>
                    <span className="rounded-full border border-white/8 bg-black/20 px-3 py-1">{tournament.isPublished ? "Published" : "Hidden"}</span>
                    <span className="rounded-full border border-white/8 bg-black/20 px-3 py-1">{getTournamentRegistrationLabel(tournament)}</span>
                  </div>
                </div>
                <div className="grid gap-1 text-sm text-slate-400">
                  <p>Registrations: <span className="text-white">{tournament.registrationCount} / {tournament.maxTeams}</span></p>
                  <p>Prize Pool: <span className="text-white">{tournament.prizePool}</span></p>
                </div>
                <div className="flex flex-wrap gap-3 xl:justify-end">
                  <Link href={`/admin/tournaments/${tournament.id}/edit`} className={buttonClassName({ variant: "secondary" })}>Edit</Link>
                  <Button type="button" variant="secondary" onClick={() => handleQuickUpdate(tournament, { isPublished: !tournament.isPublished })}>
                    {tournament.isPublished ? "Unpublish" : "Publish"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      handleQuickUpdate(tournament, {
                        status: tournament.status === "registration_open" ? "upcoming" : "registration_open",
                      })
                    }
                  >
                    {tournament.status === "registration_open" ? "Close Reg" : "Open Reg"}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => handleDelete(tournament.id)}>Delete</Button>
                </div>
              </div>
            ))}
            {pagination ? (
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination, "tournaments")}</p>
                <div className="flex gap-3">
                  <Button type="button" variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                  <Button type="button" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Next</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
