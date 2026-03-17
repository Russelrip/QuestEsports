"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { adminRequest } from "@/lib/admin";
import {
  Tournament,
  getTournamentRegistrationLabel,
  getTournamentStatusBadgeClassName,
  getTournamentStatusLabel,
} from "@/lib/tournaments";

export default function AdminTournamentsManager() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");

  const loadTournaments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (status) {
        params.set("status", status);
      }
      if (visibility) {
        params.set("isPublished", visibility);
      }

      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await adminRequest<{ tournaments: Tournament[] }>(
        `/api/admin/tournaments${suffix}`
      );
      setTournaments(data.tournaments);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load tournaments."
      );
    } finally {
      setLoading(false);
    }
  }, [search, status, visibility]);

  useEffect(() => {
    void loadTournaments();
  }, [loadTournaments]);

  const handleDelete = async (tournamentId: string) => {
    if (
      !window.confirm(
        "Delete this tournament? This will also remove related registrations."
      )
    ) {
      return;
    }

    try {
      await adminRequest(`/api/admin/tournaments/${tournamentId}`, {
        method: "DELETE",
      });
      setTournaments((current) =>
        current.filter((tournament) => tournament.id !== tournamentId)
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to delete tournament."
      );
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
      body.append(
        "isPublished",
        String(
          typeof updates.isPublished === "boolean"
            ? updates.isPublished
            : tournament.isPublished
        )
      );
      body.append("isFeatured", String(tournament.isFeatured));
      if (tournament.bracketLink) {
        body.append("bracketLink", tournament.bracketLink);
      }
      if (tournament.contactLink) {
        body.append("contactLink", tournament.contactLink);
      }

      const data = await adminRequest<{ tournament: Tournament }>(
        `/api/admin/tournaments/${tournament.id}`,
        {
          method: "PATCH",
          body,
        }
      );

      setTournaments((current) =>
        current.map((item) => (item.id === tournament.id ? data.tournament : item))
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to update tournament."
      );
    }
  };

  return (
    <AdminShell
      title="Tournaments"
      description="Create, edit, publish, and manage every tournament from the dashboard."
      actions={
        <Link href="/admin/tournaments/new" className="btn btn-primary btn-small">
          New Tournament
        </Link>
      }
    >
      <div className="admin-users-card">
        <div className="admin-users-head">
          <div>
            <h3>Tournament List</h3>
            <p>Search and filter tournaments before editing or publishing them.</p>
          </div>
          <div className="admin-filter-row">
            <input
              type="search"
              className="admin-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, slug, or game..."
            />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="upcoming">Upcoming</option>
              <option value="registration_open">Registration Open</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value)}
            >
              <option value="">All visibility</option>
              <option value="true">Published</option>
              <option value="false">Hidden</option>
            </select>
          </div>
        </div>

        {loading ? (
          <EmptyState description="Loading tournaments..." />
        ) : error ? (
          <EmptyState description={error} />
        ) : tournaments.length === 0 ? (
          <EmptyState description="No tournaments matched your current search or filters." />
        ) : (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Game</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Registrations</th>
                  <th>Registration</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tournaments.map((tournament) => (
                  <tr key={tournament.id}>
                    <td>
                      <strong>{tournament.title}</strong>
                      <br />
                      <small>{tournament.slug}</small>
                    </td>
                    <td>{tournament.game}</td>
                    <td>
                      <span className={getTournamentStatusBadgeClassName(tournament.status)}>
                        {getTournamentStatusLabel(tournament.status)}
                      </span>
                    </td>
                    <td>{tournament.isPublished ? "Published" : "Hidden"}</td>
                    <td>
                      {tournament.registrationCount} / {tournament.maxTeams}
                    </td>
                    <td>{getTournamentRegistrationLabel(tournament)}</td>
                    <td>
                      <div className="admin-table-actions">
                        <Link
                          href={`/admin/tournaments/${tournament.id}/edit`}
                          className="btn btn-secondary btn-small"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() =>
                            handleQuickUpdate(tournament, {
                              isPublished: !tournament.isPublished,
                            })
                          }
                        >
                          {tournament.isPublished ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() =>
                            handleQuickUpdate(tournament, {
                              status:
                                tournament.status === "registration_open"
                                  ? "upcoming"
                                  : "registration_open",
                            })
                          }
                        >
                          {tournament.status === "registration_open"
                            ? "Close Reg"
                            : "Open Reg"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small admin-danger-button"
                          onClick={() => handleDelete(tournament.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
