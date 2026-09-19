"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminEventRegistrations, useAdminRegistrations } from "@/hooks/api/useAdmin";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToastStore } from "@/hooks/useToastStore";
import {
  adminRequest,
  downloadAdminFile,
  formatAdminCompactDateTime,
  getAdminPaginationSummary,
  type TeamRegistration,
  type TeamRegistrationSummary,
} from "@/lib/admin";
import { RegistrationDetail } from "./registrations/RegistrationDetail";
import { paymentStatusLabel } from "./registrations/registration-model";
import { StatusText } from "./registrations/registration-ui";

// The server clamps the registrations list at 100 rows per page.
const REGISTRATION_PAGE_SIZES = [25, 50, 75, 100] as const;

export default function AdminRegistrationsManager({ eventId, eventTitle }: { eventId?: string; eventTitle?: string } = {}) {
  const [search, setSearch] = useState("");
  const [tournament, setTournament] = useState("");
  const [game, setGame] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(REGISTRATION_PAGE_SIZES[0]);
  const [downloading, setDownloading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRegistration, setSelectedRegistration] =
    useState<TeamRegistration | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  // Only the free-text search is debounced. A dropdown emits one deliberate
  // value, so delaying it just makes the filter look like it did nothing.
  const debouncedSearch = useDebouncedValue(search);
  const globalQuery = useAdminRegistrations(
    debouncedSearch,
    tournament,
    status,
    page,
    pageSize,
    !eventId,
  );
  const eventQuery = useAdminEventRegistrations(
    eventId || "",
    debouncedSearch,
    tournament,
    game,
    status,
    page,
    pageSize,
    Boolean(eventId),
  );
  const { data, error, loading, refetch } = eventId ? eventQuery : globalQuery;
  const showToast = useToastStore((state) => state.showToast);
  const registrations = data?.registrations || [];
  const tournaments = data?.tournaments || [];
  const games = Array.from(new Set(tournaments.map((item) => item.game).filter(Boolean))) as string[];
  const pagination = data?.pagination;
  const selectedTournamentTitle = tournaments.find((item) => item.slug === tournament)?.title;
  const activeFilterLabels = [
    ...(search.trim() ? [`Search: ${search.trim()}`] : []),
    ...(tournament ? [selectedTournamentTitle || tournament] : []),
    ...(game ? [game] : []),
    ...(status ? [status.charAt(0).toUpperCase() + status.slice(1)] : []),
  ];
  const hasActiveFilters = activeFilterLabels.length > 0;
  const registrationGroups = registrations.reduce<
    Array<{
      tournament: TeamRegistrationSummary["tournament"];
      entries: TeamRegistrationSummary[];
    }>
  >((groups, registration) => {
    const existing = groups.find(
      (group) => group.tournament.id === registration.tournament.id,
    );
    if (existing) existing.entries.push(registration);
    else
      groups.push({
        tournament: registration.tournament,
        entries: [registration],
      });
    return groups;
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const data = await adminRequest<{ registration: TeamRegistration }>(
        `/api/admin/team-registrations/${selectedId}`,
      );
      setSelectedRegistration(data.registration);
    } catch (nextError) {
      setDetailError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load this registration.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedRegistration(null);
      setDetailError("");
      return;
    }
    void loadDetail();
  }, [loadDetail, selectedId]);

  const buildExportPath = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (tournament.trim()) params.set("tournament", tournament.trim());
    if (game.trim()) params.set("game", game.trim());
    if (status.trim()) params.set("status", status.trim());
    if (eventId) params.set("eventId", eventId);
    const query = params.toString();
    return `/api/admin/team-registrations/export${query ? `?${query}` : ""}`;
  };

  const downloadRegistrations = async () => {
    setDownloading(true);
    try {
      await downloadAdminFile(buildExportPath(), "team-registrations.xlsx");
      showToast({ tone: "success", title: "Excel download started" });
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to download registrations",
        description:
          nextError instanceof Error ? nextError.message : "Download failed.",
      });
    } finally {
      setDownloading(false);
    }
  };

  const refreshDetailAndList = async () => {
    await Promise.all([refetch(), loadDetail()]);
  };

  return (
    <AdminShell
      title="Registrations"
      description="Browse lightweight registration summaries, then open one submission to review its complete roster and controls."
    >
      {selectedId ? (
        <RegistrationDetail
          registration={selectedRegistration}
          loading={detailLoading}
          error={detailError}
          onBack={() => setSelectedId(null)}
          onChanged={refreshDetailAndList}
          onDeleted={async () => {
            setSelectedId(null);
            setSelectedRegistration(null);
            await refetch();
          }}
        />
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-white/10 p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h3 className="text-2xl text-white">
                  Tournament registrations
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Full rosters load only when you open a registration.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-6">
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search teams or captains..."
                />
                <Select
                  value={tournament}
                  onChange={(event) => {
                    setTournament(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All tournaments</option>
                  {tournaments.map((item) => (
                    <option key={item.id} value={item.slug}>
                      {item.title}
                    </option>
                  ))}
                </Select>
                {eventId ? (
                  <Select
                    value={game}
                    onChange={(event) => {
                      setGame(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All Games</option>
                    {games.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                ) : null}
                <Select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="waitlisted">Waitlisted</option>
                </Select>
                <Select
                  aria-label="Registrations per page"
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {REGISTRATION_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      Show {size}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={downloading}
                  onClick={() => void downloadRegistrations()}
                >
                  {downloading ? "Downloading..." : "Download Excel"}
                </Button>
              </div>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-3 sm:px-6">
              <span className="text-xs uppercase tracking-wider text-slate-500">Filtered by</span>
              {activeFilterLabels.map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
              <button
                type="button"
                className="ml-auto text-xs text-purple-200 underline-offset-4 hover:underline"
                onClick={() => {
                  setSearch("");
                  setTournament("");
                  setGame("");
                  setStatus("");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="p-5 sm:p-6">
              <AdminTableSkeleton />
            </div>
          ) : error ? (
            <div className="p-5">
              <EmptyState description={error} />
            </div>
          ) : registrations.length === 0 ? (
            <div className="p-5">
              <EmptyState description="No registrations matched your filters." />
            </div>
          ) : (
            <>
              <div className="grid gap-4 p-3 md:hidden">
                {registrationGroups.map((group) => (
                  <section key={group.tournament.id} className="grid gap-3">
                    <div className="border border-purple-300/15 bg-purple-400/[0.06] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-purple-100">
                      {group.tournament.title} · {group.entries.length} registration{group.entries.length === 1 ? "" : "s"}
                    </div>
                    {group.entries.map((registration) => (
                      <article key={registration.id} className="min-w-0 border border-white/10 bg-white/[0.03] p-4">
                        <div className="min-w-0">
                          <h4 className="break-words font-semibold text-white">{registration.teamName}</h4>
                          <p className="mt-1 text-xs text-slate-500">{formatAdminCompactDateTime(registration.createdAt)}</p>
                          <p className="mt-1 text-xs text-purple-200">{registration.event?.title || eventTitle || "Event not assigned"} · {registration.tournament.game || "Game not set"}</p>
                        </div>
                        <div className="mt-4 min-w-0 text-sm">
                          <p className="break-words text-slate-300">{registration.captain.name}</p>
                          <p className="break-all text-xs text-slate-500">{registration.captain.email}</p>
                          {registration.coachName ? (
                            <p className="mt-2 break-words text-xs text-slate-500">
                              Coach: {registration.coachRiotId || registration.coachName}
                            </p>
                          ) : null}
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Approval</dt><dd className="mt-1"><StatusText value={registration.status} /></dd></div>
                          <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Payment</dt><dd className="mt-1"><StatusText value={paymentStatusLabel(registration)} /></dd></div>
                          <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Verification</dt><dd className="mt-1"><StatusText value={registration.verificationStatus} /></dd></div>
                          <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Roster</dt><dd className="mt-1 font-semibold text-white">{registration.memberCount}</dd></div>
                          <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Reference</dt><dd className="mt-1 break-all font-semibold text-white">{registration.publicReference || "—"}</dd></div>
                        </dl>
                        <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => setSelectedId(registration.id)}>
                          View & manage
                        </Button>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[980px] border-collapse text-left">
                  <thead className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Entry</th>
                      <th className="px-5 py-4 font-semibold">Event / Game</th>
                      <th className="px-5 py-4 font-semibold">Tournament</th>
                      <th className="px-5 py-4 font-semibold">Captain</th>
                      <th className="px-5 py-4 font-semibold">Approval</th>
                      <th className="px-5 py-4 font-semibold">Payment</th>
                      <th className="px-5 py-4 font-semibold">Verification</th>
                      <th className="px-5 py-4 text-center font-semibold">
                        Roster
                      </th>
                      <th className="px-5 py-4 font-semibold">Reference</th>
                      <th className="px-5 py-4 text-right font-semibold">
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {registrationGroups.map((group) => (
                      <Fragment key={group.tournament.id}>
                        <tr className="border-y border-purple-300/15 bg-purple-400/[0.06]">
                          <td
                            colSpan={10}
                            className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100"
                          >
                            {group.tournament.title} · {group.entries.length}{" "}
                            registration{group.entries.length === 1 ? "" : "s"}
                          </td>
                        </tr>
                        {group.entries.map((registration) => (
                          <tr
                            key={registration.id}
                            className="transition hover:bg-purple-300/[0.04]"
                          >
                            <td className="px-5 py-4">
                              <p className="font-semibold text-white">
                                {registration.teamName}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatAdminCompactDateTime(
                                  registration.createdAt,
                                )}
                              </p>
                            </td>
                            <td className="px-5 py-4 text-sm text-slate-300">
                              <p>{registration.event?.title || eventTitle || "Event not assigned"}</p>
                              <p className="mt-1 text-xs text-slate-500">{registration.tournament.game || "Game not set"}</p>
                            </td>
                            <td className="px-5 py-4 text-sm text-slate-300">
                              {registration.tournament.title}
                            </td>
                            <td className="px-5 py-4">
                              <p className="text-sm text-slate-300">
                                {registration.captain.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {registration.captain.email}
                              </p>
                              {registration.coachName ? (
                                <p className="mt-2 text-xs text-slate-500">
                                  Coach: {registration.coachRiotId || registration.coachName}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-5 py-4">
                              <StatusText value={registration.status} />
                            </td>
                            <td className="px-5 py-4">
                              <StatusText value={paymentStatusLabel(registration)} />
                            </td>
                            <td className="px-5 py-4">
                              <StatusText
                                value={registration.verificationStatus}
                              />
                            </td>
                            <td className="px-5 py-4 text-center text-sm font-semibold text-white">
                              {registration.memberCount}
                            </td>
                            <td className="px-5 py-4 text-sm text-slate-300">
                              {registration.publicReference || "—"}
                            </td>
                            <td className="px-5 py-4 text-right">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setSelectedId(registration.id)}
                              >
                                View & manage
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagination ? (
                <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-400">
                    {getAdminPaginationSummary(pagination, "registrations")}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((current) => current - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Card>
      )}
    </AdminShell>
  );
}
