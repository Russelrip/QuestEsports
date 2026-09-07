"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
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
import { getCoachValidationMessage, type CoachDraft } from "@/lib/tournament-coach";
import {
  TEAM_LOGO_MAX_FILE_SIZE,
  assertFileWithinUploadLimit,
} from "@/lib/upload-limits";

type RosterDraftMember = {
  key: string;
  id?: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE";
  name: string;
  email: string;
  discord: string;
  gameId: string;
};

type RegistrationCoach = {
  name: string;
  email: string;
  phone: string;
  // Null when the coach had no connected Discord at submission time. It is
  // read-only here either way: the value is resolved from their account, never
  // typed by an admin.
  discord: string | null;
  riotId: string;
};

const createRosterDraftMember = (
  role: RosterDraftMember["role"],
): RosterDraftMember => ({
  key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  role,
  name: "",
  email: "",
  discord: "",
  gameId: "",
});

export default function AdminRegistrationsManager({ eventId, eventTitle }: { eventId?: string; eventTitle?: string } = {}) {
  const [search, setSearch] = useState("");
  const [tournament, setTournament] = useState("");
  const [game, setGame] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRegistration, setSelectedRegistration] =
    useState<TeamRegistration | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const debouncedTournament = useDebouncedValue(tournament);
  const debouncedGame = useDebouncedValue(game);
  const debouncedStatus = useDebouncedValue(status);
  const globalQuery = useAdminRegistrations(
    debouncedSearch,
    debouncedTournament,
    debouncedStatus,
    page,
    !eventId,
  );
  const eventQuery = useAdminEventRegistrations(
    eventId || "",
    debouncedSearch,
    debouncedTournament,
    debouncedGame,
    debouncedStatus,
    page,
    Boolean(eventId),
  );
  const { data, error, loading, refetch } = eventId ? eventQuery : globalQuery;
  const showToast = useToastStore((state) => state.showToast);
  const registrations = data?.registrations || [];
  const tournaments = data?.tournaments || [];
  const games = Array.from(new Set(tournaments.map((item) => item.game).filter(Boolean))) as string[];
  const pagination = data?.pagination;
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
              <div className="grid gap-3 md:grid-cols-5">
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
                          <p className="mt-1 text-xs text-purple-200">{eventTitle || "Event not assigned"} · {registration.tournament.game || "Game not set"}</p>
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
                          <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Payment</dt><dd className="mt-1"><StatusText value={registration.paymentStatus} /></dd></div>
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
                              <p>{eventTitle || "Event not assigned"}</p>
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
                              <StatusText value={registration.paymentStatus} />
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

function RegistrationDetail({
  registration,
  loading,
  error,
  onBack,
  onChanged,
  onDeleted,
}: {
  registration: TeamRegistration | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [captainGameId, setCaptainGameId] = useState("");
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
  const [memberGameIds, setMemberGameIds] = useState<Record<string, string>>(
    {},
  );
  const [rosterMembers, setRosterMembers] = useState<RosterDraftMember[]>([]);
  const [coachDraft, setCoachDraft] = useState<CoachDraft | null>(null);
  const [coachRemoved, setCoachRemoved] = useState(false);
  const [syncSavedTeam, setSyncSavedTeam] = useState(false);
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    if (!registration) return;
    setCaptainGameId(registration.captain.riotId || "");
    setMemberGameIds(
      Object.fromEntries(
        registration.members.map((member) => [
          member.id,
          member.role === "CAPTAIN"
            ? registration.captain.riotId || member.riotId || ""
            : member.riotId || "",
        ]),
      ),
    );
    setRosterMembers(
      registration.members.map((member) => ({
        key: member.id,
        id: member.id,
        role:
          member.role === "CAPTAIN"
            ? "CAPTAIN"
            : member.role === "SUBSTITUTE"
              ? "SUBSTITUTE"
              : "PLAYER",
        name: member.name,
        email: member.email || "",
        discord: member.discord || "",
        gameId: member.riotId || "",
      })),
    );
    setSyncSavedTeam(registration.savedTeamLinked);
    setCoachDraft(
      registration.coach
        ? {
            name: registration.coach.name || "",
            email: registration.coach.email || "",
            phone: registration.coach.phone || "",
            gameId: registration.coach.riotId || "",
          }
        : null,
    );
    setCoachRemoved(false);
  }, [registration]);

  const coachPayload = (): RegistrationCoach | null => {
    if (coachRemoved) return null;
    if (coachDraft && !Object.values(coachDraft).every((value) => !value.trim())) {
      return {
        name: coachDraft.name.trim(),
        email: coachDraft.email.trim(),
        phone: coachDraft.phone.trim(),
        // Carried through untouched. The handle was resolved from the coach's
        // connected account when the registration was submitted, and an admin
        // retyping it here would replace a verified value with a typed one.
        discord: registration?.coach?.discord || null,
        riotId: coachDraft.gameId.trim(),
      };
    }
    return registration?.coach || null;
  };

  const coachValidationMessage = () => {
    if (!coachDraft) return "";
    return getCoachValidationMessage(
      coachDraft,
      Boolean(registration?.tournament.coachRequired),
    );
  };

  const patchRoster = async (
    coach: RegistrationCoach | null,
    busyKey: string,
    successTitle: string,
  ) => {
    if (!registration) return;
    setBusyAction(busyKey);
    try {
      await adminRequest(
        `/api/admin/team-registrations/${registration.id}/roster`,
        {
          method: "PATCH",
          json: {
            syncSavedTeam,
            coach,
            members: rosterMembers.map((member) => ({
              id: member.id,
              role: member.role,
              name: member.name,
              email: member.email,
              discord: member.discord,
              gameId: member.gameId,
            })),
          },
        },
      );
      showToast({ tone: "success", title: successTitle });
      await onChanged();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update registration roster",
        description:
          nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const updateRosterMember = (
    key: string,
    field: keyof Omit<RosterDraftMember, "key" | "id">,
    value: string,
  ) => {
    setRosterMembers((current) =>
      current.map((member) =>
        member.key === key ? { ...member, [field]: value } : member,
      ),
    );
  };

  const saveRosterCorrection = async () => {
    if (!registration) return;
    const coachError = coachValidationMessage();
    if (coachError) {
      showToast({ tone: "error", title: coachError });
      return;
    }
    const captainCount = rosterMembers.filter(
      (member) => member.role === "CAPTAIN",
    ).length;
    if (captainCount !== 1) {
      showToast({ tone: "error", title: "Choose exactly one captain" });
      return;
    }
    const playerCount = rosterMembers.filter(
      (member) => member.role === "CAPTAIN" || member.role === "PLAYER",
    ).length;
    const substituteCount = rosterMembers.filter(
      (member) => member.role === "SUBSTITUTE",
    ).length;
    const savedTeamMessage = syncSavedTeam
      ? " The linked saved-team roster will also be replaced."
      : "";
    if (
      !window.confirm(
        `Replace ${registration.teamName}'s tournament roster with ${playerCount} active players and ${substituteCount} substitutes?${savedTeamMessage}`,
      )
    )
      return;

    await patchRoster(
      coachPayload(),
      "roster",
      "Registration roster corrected",
    );
  };

  const saveCoach = async () => {
    const coachError = coachValidationMessage();
    if (coachError) {
      showToast({ tone: "error", title: coachError });
      return;
    }
    await patchRoster(coachPayload(), "coach", "Registration coach updated");
  };

  const removeCoach = async () => {
    if (!registration || !window.confirm(`Remove the coach from ${registration.teamName}?`)) return;
    setCoachRemoved(true);
    await patchRoster(null, "coach", "Registration coach removed");
  };

  const updateRegistration = async (
    updates: Partial<
      Pick<TeamRegistration, "status" | "verificationStatus">
    > & { adminOverridePayment?: boolean },
  ) => {
    if (!registration) return;
    setBusyAction("status");
    try {
      await adminRequest(
        `/api/admin/team-registrations/${registration.id}/status`,
        { method: "PATCH", json: updates },
      );
      showToast({ tone: "success", title: "Registration updated" });
      await onChanged();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update registration",
        description:
          nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const togglePrivateSlot = async () => {
    if (!registration) return;
    const releasing = Boolean(registration.adminSlotReservation);
    const note = releasing
      ? ""
      : window.prompt(
          "Optional private admin note (not visible to the team):",
          "",
        );
    if (!releasing && note === null) return;
    if (
      releasing &&
      !window.confirm(
        `Release the private slot held for ${registration.teamName}?`,
      )
    )
      return;
    setBusyAction("slot");
    try {
      await adminRequest(
        `/api/admin/team-registrations/${registration.id}/slot-reservation`,
        {
          method: releasing ? "DELETE" : "POST",
          json: releasing ? undefined : { note },
        },
      );
      showToast({
        tone: "success",
        title: releasing ? "Private slot released" : "Private slot reserved",
      });
      await onChanged();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update slot hold",
        description:
          nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const saveRegistrationLogo = async (removeLogo: boolean) => {
    if (!registration) return;
    setBusyAction("logo");
    try {
      if (!removeLogo) assertFileWithinUploadLimit(teamLogo, TEAM_LOGO_MAX_FILE_SIZE, "Team logo");
      const body = new FormData();
      body.append("removeLogo", String(removeLogo));
      if (!removeLogo && teamLogo) body.append("teamLogo", teamLogo);
      await adminRequest(`/api/admin/team-registrations/${registration.id}/logo`, {
        method: "PATCH",
        body,
      });
      setTeamLogo(null);
      showToast({ tone: "success", title: removeLogo ? "Registration logo removed" : "Registration logo updated" });
      await onChanged();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update the registration logo",
        description:
          nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const saveGameIds = async () => {
    if (!registration) return;
    setBusyAction("game-ids");
    try {
      await adminRequest(
        `/api/admin/team-registrations/${registration.id}/game-ids`,
        {
          method: "PATCH",
          json: {
            captainGameId,
            members: registration.members.map((member) => ({
              id: member.id,
              gameId:
                member.role === "CAPTAIN"
                  ? captainGameId
                  : memberGameIds[member.id] || "",
            })),
          },
        },
      );
      showToast({ tone: "success", title: "Registration Game IDs updated" });
      await onChanged();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update Game IDs",
        description:
          nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const deleteRegistration = async () => {
    if (
      !registration ||
      !window.confirm(`Delete the registration for ${registration.teamName}?`)
    )
      return;
    setBusyAction("delete");
    try {
      await adminRequest(`/api/admin/team-registrations/${registration.id}`, {
        method: "DELETE",
      });
      showToast({ tone: "success", title: "Registration deleted" });
      await onDeleted();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to delete registration",
        description:
          nextError instanceof Error ? nextError.message : "Request failed.",
      });
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <Button type="button" variant="secondary" onClick={onBack}>
        ← Back to registrations
      </Button>
      {error ? (
        <Card className="p-6 text-sm text-rose-300">{error}</Card>
      ) : null}
      {loading ? (
        <Card className="p-5">
          <AdminTableSkeleton />
        </Card>
      ) : null}
      {!loading && registration ? (
        <Card className="min-w-0 overflow-hidden p-5 sm:p-6">
          <div className="border-b border-white/10 pb-5">
            <p className="text-xs uppercase tracking-[0.2em] text-purple-200">
              {registration.entryType === "solo"
                ? "Solo registration"
                : "Team registration"}
            </p>
            <h3 className="mt-2 text-2xl text-white">
              {registration.teamName}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {registration.tournament.title} · Submitted{" "}
              {formatAdminCompactDateTime(registration.createdAt)}
            </p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <DetailBlock
              title="Captain"
              rows={[
                ["Name", registration.captain.name],
                ["Email", registration.captain.email],
                ["Phone", registration.captain.phone],
                ["Discord", registration.captain.discord],
                ["Game ID", registration.captain.riotId],
                ["Contact", registration.contactEmail],
              ]}
            />
            <DetailBlock
              title="Entry"
              rows={[
                ["Country", registration.country || "Not set"],
                ["Team tag", registration.teamTag || "Not set"],
                [
                  "Organization requested",
                  registration.organizationRequested ? "Yes" : "No",
                ],
                ["Payment", registration.paymentStatus],
                [
                  "Reserved until",
                  registration.reservedUntil
                    ? formatAdminCompactDateTime(registration.reservedUntil)
                    : "Not reserved",
                ],
              ]}
            />
            <div className="border border-white/10 bg-black/15 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Management
              </p>
              <label className="mt-4 grid gap-2 text-sm text-slate-300">
                Approval
                <Select
                  disabled={busyAction !== null}
                  value={registration.status}
                  onChange={(event) =>
                    void updateRegistration({
                      status: event.target.value as TeamRegistration["status"],
                    })
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  {registration.tournament.waitlistEnabled || registration.status === "waitlisted" ? (
                    <option value="waitlisted">Waitlisted</option>
                  ) : null}
                </Select>
              </label>
              <label className="mt-3 grid gap-2 text-sm text-slate-300">
                Verification
                <Select
                  disabled={busyAction !== null}
                  value={registration.verificationStatus}
                  onChange={(event) =>
                    void updateRegistration({
                      verificationStatus: event.target
                        .value as TeamRegistration["verificationStatus"],
                    })
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="flagged">Flagged</option>
                </Select>
              </label>
              {registration.paymentStatus !== "paid" &&
              registration.status !== "rejected" ? (
                <Button
                  className="mt-3 w-full"
                  type="button"
                  variant="secondary"
                  disabled={busyAction !== null}
                  onClick={() =>
                    window.confirm(
                      `Approve ${registration.teamName} without payment? This will waive the registration fee.`,
                    ) &&
                    void updateRegistration({
                      status: "approved",
                      adminOverridePayment: true,
                    })
                  }
                >
                  Approve without payment
                </Button>
              ) : null}
            </div>
          </div>

          {registration.adminSlotReservation ? (
            <div className="mt-5 border border-purple-300/20 bg-purple-400/10 p-4 text-sm text-purple-100">
              Slot #{registration.adminSlotReservation.assignedSlotNumber}{" "}
              privately held ·{" "}
              {registration.adminSlotReservation.quotedFeeCurrency}{" "}
              {registration.adminSlotReservation.quotedFeeAmount.toFixed(2)}
              {registration.adminSlotReservation.note
                ? ` · ${registration.adminSlotReservation.note}`
                : ""}
            </div>
          ) : null}
          {registration.paymentStatus !== "paid" &&
          registration.status !== "rejected" &&
          (registration.adminSlotReservation ||
            registration.members.some(
              (member) => member.inviteStatus === "pending",
            )) ? (
            <Button
              className="mt-4"
              type="button"
              variant="secondary"
              disabled={busyAction !== null}
              onClick={() => void togglePrivateSlot()}
            >
              {busyAction === "slot"
                ? "Updating..."
                : registration.adminSlotReservation
                  ? "Release private slot"
                  : "Reserve slot privately"}
            </Button>
          ) : null}

          <DataFields
            title="Registration fields"
            values={registration.additionalData}
          />

          {registration.tournament.allowCoach ? (
            <div className="mt-7 border border-cyan-300/20 bg-cyan-400/[0.06] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-cyan-100">
                    Coach
                  </h4>
                  <p className="mt-1 text-sm text-slate-400">
                    Coaches are managed separately from the numbered player roster and do not require a Quest account.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busyAction !== null || !registration.coach}
                    variant="danger"
                    onClick={() => void removeCoach()}
                  >
                    Remove coach
                  </Button>
                  <Button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void saveCoach()}
                  >
                    {busyAction === "coach" ? "Saving..." : "Save coach"}
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  ["name", "Full name", "text"],
                  ["email", "Email", "email"],
                  ["phone", "Contact number", "tel"],
                  ["gameId", "Riot ID / IGN", "text"],
                ] as const).map(([field, label, type]) => (
                  <label key={field} className="grid gap-1 text-sm text-slate-300">
                    {label}
                    <Input
                      type={type}
                      value={coachDraft?.[field] || ""}
                      onChange={(event) => {
                        setCoachRemoved(false);
                        setCoachDraft((current) => ({
                          name: current?.name || "",
                          email: current?.email || "",
                          phone: current?.phone || "",
                          gameId: current?.gameId || "",
                          [field]: event.target.value,
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
              {registration.tournament.coachRequired ? (
                <p className="mt-3 text-xs text-cyan-100/70">A coach is required for this tournament.</p>
              ) : null}
            </div>
          ) : null}

          {registration.entryType !== "solo" ? (
            <div className="mt-7 border border-amber-300/20 bg-amber-400/[0.06] p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-amber-100">
                    Roster correction
                  </h4>
                  <p className="mt-1 max-w-3xl text-sm text-slate-400">
                    Choose exactly one captain. Replacing this list is allowed
                    for paid registrations, requires verified Quest accounts,
                    and is recorded in the audit log.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Event limits: {registration.tournament.minRosterSize || 1}-
                    {registration.tournament.maxRosterSize || 1} active players
                    including the captain, up to{" "}
                    {registration.tournament.maxSubstitutes || 0} substitutes.
                  </p>
                </div>
                <Button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void saveRosterCorrection()}
                >
                  {busyAction === "roster"
                    ? "Saving..."
                    : "Apply roster correction"}
                </Button>
              </div>

              <div className="mt-4 grid gap-3">
                {rosterMembers.map((member, index) => (
                  <div
                    key={member.key}
                    className="border border-white/10 bg-black/15 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">
                        Roster member {index + 1}
                      </p>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={busyAction !== null}
                        onClick={() =>
                          setRosterMembers((current) =>
                            current.filter((item) => item.key !== member.key),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="grid gap-1 text-sm text-slate-300">
                        Role
                        <Select
                          value={member.role}
                          onChange={(event) =>
                            updateRosterMember(
                              member.key,
                              "role",
                              event.target.value,
                            )
                          }
                        >
                          <option value="CAPTAIN">Captain</option>
                          <option value="PLAYER">Main player</option>
                          <option value="SUBSTITUTE">Substitute</option>
                        </Select>
                      </label>
                      <label className="grid gap-1 text-sm text-slate-300">
                        Player name
                        <Input
                          required
                          value={member.name}
                          onChange={(event) =>
                            updateRosterMember(
                              member.key,
                              "name",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-300">
                        Quest account email
                        <Input
                          required
                          type="email"
                          value={member.email}
                          onChange={(event) =>
                            updateRosterMember(
                              member.key,
                              "email",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-300">
                        Game ID
                        <Input
                          required
                          value={member.gameId}
                          onChange={(event) =>
                            updateRosterMember(
                              member.key,
                              "gameId",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm text-slate-300">
                        Discord
                        <Input
                          required
                          value={member.discord}
                          onChange={(event) =>
                            updateRosterMember(
                              member.key,
                              "discord",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyAction !== null || rosterMembers.length >= 20}
                  onClick={() =>
                    setRosterMembers((current) => [
                      ...current,
                      createRosterDraftMember("PLAYER"),
                    ])
                  }
                >
                  Add main player
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyAction !== null || rosterMembers.length >= 20}
                  onClick={() =>
                    setRosterMembers((current) => [
                      ...current,
                      createRosterDraftMember("SUBSTITUTE"),
                    ])
                  }
                >
                  Add substitute
                </Button>
              </div>

              {registration.savedTeamLinked ? (
                <label className="mt-4 flex items-start gap-3 border border-white/10 bg-black/15 p-4 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={syncSavedTeam}
                    onChange={(event) => setSyncSavedTeam(event.target.checked)}
                  />
                  <span>
                    <span className="font-semibold text-white">
                      Replace the linked saved-team roster too
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Required when changing the captain. This also transfers
                      saved-team ownership.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="mt-7 border border-purple-300/20 bg-purple-400/[0.06] p-4 sm:p-5">
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-purple-100">
                Team logo
              </h4>
              {registration.savedTeamLinked ? (
                <p className="mt-1 text-sm text-slate-400">
                  This registration is linked to a saved team, so the saved
                  team&apos;s logo is used everywhere. Edit it on the team to keep
                  every linked registration in sync.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-400">
                    This registration is not linked to a saved team, so it carries
                    its own logo. PNG, JPG, or WebP, up to 5&nbsp;MB.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    {registration.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={registration.logoUrl}
                        alt=""
                        className="size-16 border border-white/10 object-cover"
                      />
                    ) : (
                      <span className="flex size-16 items-center justify-center border border-white/10 bg-white/5 text-xs text-slate-500">
                        None
                      </span>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busyAction !== null}
                      onChange={(event) => setTeamLogo(event.target.files?.[0] ?? null)}
                      className="max-w-full text-sm text-slate-300 file:mr-3 file:border file:border-white/10 file:bg-white/5 file:px-3 file:py-2 file:text-sm file:text-white"
                    />
                    <Button
                      type="button"
                      disabled={busyAction !== null || !teamLogo}
                      onClick={() => void saveRegistrationLogo(false)}
                    >
                      {busyAction === "logo" ? "Saving..." : "Save logo"}
                    </Button>
                    {registration.logoUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busyAction !== null}
                        onClick={() => void saveRegistrationLogo(true)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-7 border border-purple-300/20 bg-purple-400/[0.06] p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-purple-100">
                  Game IDs
                </h4>
                <p className="mt-1 text-sm text-slate-400">
                  Edit the IDs for this tournament only. The saved team and its
                  other registrations are not changed.
                </p>
              </div>
              <Button
                type="button"
                disabled={busyAction !== null}
                onClick={() => void saveGameIds()}
              >
                {busyAction === "game-ids" ? "Saving..." : "Save Game IDs"}
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {registration.members.map((member) => (
                <label
                  key={member.id}
                  className="grid min-w-0 gap-1 text-sm text-slate-300"
                >
                  <span className="break-words">
                    {member.name}{" "}
                    <span className="text-xs uppercase text-slate-500">
                      · {member.role.toLowerCase()}
                    </span>
                  </span>
                  <Input
                    required
                    value={
                      member.role === "CAPTAIN"
                        ? captainGameId
                        : memberGameIds[member.id] || ""
                    }
                    placeholder="Player ID / Riot ID"
                    onChange={(event) => {
                      if (member.role === "CAPTAIN") {
                        setCaptainGameId(event.target.value);
                      } else {
                        setMemberGameIds((current) => ({
                          ...current,
                          [member.id]: event.target.value,
                        }));
                      }
                    }}
                  />
                  <span className="truncate text-xs text-slate-500">
                    {member.email || "No email"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Roster · {registration.members.length}
            </h4>
            <div className="mt-3 grid gap-3">
              {registration.members.map((member) => (
                <div
                  key={member.id}
                  className="border border-white/10 bg-black/15 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-white">{member.name}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {member.role.toLowerCase()} ·{" "}
                        {member.email || "No email"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {member.riotId || "No game ID"}
                        {member.discord ? ` · Discord ${member.discord}` : ""}
                      </p>
                    </div>
                    <StatusText value={member.inviteStatus} />
                  </div>
                  <DataFields
                    title="Player fields"
                    values={member.additionalData}
                    compact
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <Button
              type="button"
              variant="danger"
              disabled={busyAction !== null}
              onClick={() => void deleteRegistration()}
            >
              {busyAction === "delete" ? "Deleting..." : "Delete registration"}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function StatusText({ value }: { value: string }) {
  const tone = ["paid", "approved", "verified", "accepted"].includes(value)
    ? "text-emerald-300"
    : ["rejected", "failed", "flagged", "declined", "cancelled"].includes(value)
      ? "text-rose-300"
      : "text-amber-300";
  return (
    <span className={`text-xs font-semibold uppercase tracking-wider ${tone}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function DetailBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="border border-white/10 bg-black/15 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <dl className="mt-4 grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 break-words text-sm text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DataFields({
  title,
  values,
  compact = false,
}: {
  title: string;
  values?: Record<string, string>;
  compact?: boolean;
}) {
  const entries = Object.entries(values || {}).filter(
    ([, value]) => value !== "" && value !== null && value !== undefined,
  );
  if (entries.length === 0) return null;
  return (
    <div className={compact ? "mt-4" : "mt-7"}>
      <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </h4>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([key, value]) => (
          <div key={key} className="border border-white/8 p-3">
            <dt className="text-xs text-slate-500">
              {key.replaceAll("_", " ")}
            </dt>
            <dd className="mt-1 break-words text-sm text-slate-200">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
