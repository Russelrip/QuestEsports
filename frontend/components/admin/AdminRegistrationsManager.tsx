"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import {
  Pagination,
  TeamRegistration,
  TournamentOption,
  adminRequest,
  emptyPagination,
  formatAdminDateTime,
  getAdminPaginationSummary,
} from "@/lib/admin";

export default function AdminRegistrationsManager() {
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [pagination, setPagination] = useState<Pagination>(emptyPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tournament, setTournament] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "10",
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (tournament) {
        params.set("tournament", tournament);
      }
      if (status) {
        params.set("status", status);
      }

      const data = await adminRequest<{
        registrations: TeamRegistration[];
        tournaments: TournamentOption[];
        pagination: Pagination;
      }>(`/api/admin/team-registrations?${params.toString()}`);

      setRegistrations(data.registrations);
      setTournaments(data.tournaments);
      setPagination(data.pagination);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load registrations."
      );
    } finally {
      setLoading(false);
    }
  }, [page, search, status, tournament]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRegistration = async (
    registrationId: string,
    updates: Partial<
      Pick<TeamRegistration, "status" | "paymentStatus" | "verificationStatus">
    >
  ) => {
    try {
      const data = await adminRequest<{ registration: TeamRegistration }>(
        `/api/admin/team-registrations/${registrationId}/status`,
        {
          method: "PATCH",
          json: updates,
        }
      );

      setRegistrations((current) =>
        current.map((registration) =>
          registration.id === registrationId ? data.registration : registration
        )
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update registration."
      );
    }
  };

  return (
    <AdminShell
      title="Registrations"
      description="Review registrations, filter by tournament, and update approval or payment status."
    >
      <div className="admin-users-card">
        <div className="admin-users-head">
          <div>
            <h3>Team Registrations</h3>
            <p>Each registration is clearly attached to one tournament.</p>
          </div>
          <div className="admin-filter-row">
            <input
              type="search"
              className="admin-search-input"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search teams or captains..."
            />
            <select
              value={tournament}
              onChange={(event) => {
                setPage(1);
                setTournament(event.target.value);
              }}
            >
              <option value="">All tournaments</option>
              {tournaments.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value);
              }}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {loading ? (
          <EmptyState description="Loading registrations..." />
        ) : error ? (
          <EmptyState description={error} />
        ) : registrations.length === 0 ? (
          <EmptyState description="No registrations matched your filters." />
        ) : (
          <>
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Tournament</th>
                    <th>Captain</th>
                    <th>Submitted</th>
                    <th>Approval</th>
                    <th>Payment</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((registration) => (
                    <tr key={registration.id}>
                      <td data-label="Team">{registration.teamName}</td>
                      <td data-label="Tournament">{registration.tournament.title}</td>
                      <td data-label="Captain">
                        {registration.captain.name}
                        <br />
                        <small>{registration.captain.email}</small>
                      </td>
                      <td data-label="Submitted">
                        {formatAdminDateTime(registration.createdAt)}
                      </td>
                      <td data-label="Approval">
                        <select
                          value={registration.status}
                          onChange={(event) =>
                            updateRegistration(registration.id, {
                              status: event.target.value as TeamRegistration["status"],
                            })
                          }
                        >
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>
                      <td data-label="Payment">
                        <select
                          value={registration.paymentStatus}
                          onChange={(event) =>
                            updateRegistration(registration.id, {
                              paymentStatus:
                                event.target.value as TeamRegistration["paymentStatus"],
                            })
                          }
                        >
                          <option value="unpaid">Unpaid</option>
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                        </select>
                      </td>
                      <td data-label="Verification">
                        <select
                          value={registration.verificationStatus}
                          onChange={(event) =>
                            updateRegistration(registration.id, {
                              verificationStatus:
                                event.target.value as TeamRegistration["verificationStatus"],
                            })
                          }
                        >
                          <option value="pending">Pending</option>
                          <option value="verified">Verified</option>
                          <option value="flagged">Flagged</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-pagination">
              <p>{getAdminPaginationSummary(pagination)}</p>
              <div className="admin-pagination-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
