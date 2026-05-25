"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminRegistrations } from "@/hooks/api/useAdmin";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest, getAdminPaginationSummary, type TeamRegistration } from "@/lib/admin";

export default function AdminRegistrationsManager() {
  const [search, setSearch] = useState("");
  const [tournament, setTournament] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);
  const debouncedTournament = useDebouncedValue(tournament);
  const debouncedStatus = useDebouncedValue(status);
  const { data, error, loading, refetch } = useAdminRegistrations(
    debouncedSearch,
    debouncedTournament,
    debouncedStatus,
    page
  );
  const showToast = useToastStore((state) => state.showToast);

  const registrations = data?.registrations || [];
  const tournaments = data?.tournaments || [];
  const pagination = data?.pagination;

  const updateRegistration = async (
    registrationId: string,
    updates: Partial<Pick<TeamRegistration, "status" | "paymentStatus" | "verificationStatus">>
  ) => {
    try {
      await adminRequest(`/api/admin/team-registrations/${registrationId}/status`, {
        method: "PATCH",
        json: updates,
      });
      showToast({ tone: "success", title: "Registration updated" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update registration",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  return (
    <AdminShell
      title="Registrations"
      description="Review submissions, adjust approval and payment status, and keep tournament entry data clean."
    >
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="text-2xl text-white">Team Registrations</h3>
            <p className="text-sm text-slate-400">Each registration is attached to one tournament and one captain account.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teams or captains..." />
            <Select value={tournament} onChange={(event) => setTournament(event.target.value)}>
              <option value="">All tournaments</option>
              {tournaments.map((item) => (
                <option key={item.id} value={item.slug}>{item.title}</option>
              ))}
            </Select>
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <AdminTableSkeleton />
        ) : error ? (
          <EmptyState description={error} />
        ) : registrations.length === 0 ? (
          <EmptyState description="No registrations matched your filters." />
        ) : (
          <div className="grid gap-4">
            {registrations.map((registration) => (
              <div key={registration.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/5 p-5 xl:grid-cols-[1.1fr_1fr_1fr]">
                <div>
                  <p className="font-semibold text-white">{registration.teamName}</p>
                  <p className="text-sm text-slate-400">{registration.tournament.title}</p>
                  <p className="mt-2 text-sm text-slate-500">{registration.captain.name} · {registration.captain.email}</p>
                  <p className="text-sm text-slate-500">Submitted {new Date(registration.createdAt).toLocaleString()}</p>
                </div>
                <div className="grid gap-3">
                  <label className="grid gap-2 text-sm text-slate-300">
                    Approval
                    <Select
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
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm text-slate-300">
                    Payment
                    <Select
                      value={registration.paymentStatus}
                      onChange={(event) =>
                        updateRegistration(registration.id, {
                          paymentStatus: event.target.value as TeamRegistration["paymentStatus"],
                        })
                      }
                    >
                      <option value="unpaid">Unpaid</option>
                      <option value="pending">Pending</option>
                      <option value="paid">Paid</option>
                    </Select>
                  </label>
                </div>
                <div className="grid gap-3">
                  <label className="grid gap-2 text-sm text-slate-300">
                    Verification
                    <Select
                      value={registration.verificationStatus}
                      onChange={(event) =>
                        updateRegistration(registration.id, {
                          verificationStatus: event.target.value as TeamRegistration["verificationStatus"],
                        })
                      }
                    >
                      <option value="pending">Pending</option>
                      <option value="verified">Verified</option>
                      <option value="flagged">Flagged</option>
                    </Select>
                  </label>
                  <div className="rounded-[20px] border border-white/8 bg-black/20 p-3 text-sm text-slate-400">
                    <p>Players: {registration.members.length}</p>
                    <p>Contact: {registration.contactEmail}</p>
                  </div>
                </div>
              </div>
            ))}
            {pagination ? (
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination)}</p>
                <div className="flex gap-3">
                  <Button type="button" variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                  <Button type="button" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
