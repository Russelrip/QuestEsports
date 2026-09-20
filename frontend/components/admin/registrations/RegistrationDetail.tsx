"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest, formatAdminCompactDateTime, type TeamRegistration } from "@/lib/admin";
import { getCoachValidationMessage, type CoachDraft } from "@/lib/tournament-coach";
import { TEAM_LOGO_MAX_FILE_SIZE, assertFileWithinUploadLimit } from "@/lib/upload-limits";
import {
  type RosterDraftMember,
  type RegistrationCoach,
  createRosterDraftMember,
  RESENDABLE_INVITE_STATUSES,
  COACH_INVITE_STATUS_HINTS,
  paymentStatusLabel,
} from "./registration-model";
import { StatusText, DetailBlock, DataFields } from "./registration-ui";

export function RegistrationDetail({
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
    if (!registration?.coach) return null;
    // The invitation is the coach's own answer, not something an admin edits,
    // so only the contact details go back.
    const { name, email, phone, discord, riotId } = registration.coach;
    return { name, email, phone, discord, riotId };
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

  // Sent through the team's copy of the invitation, which is what the person
  // actually accepts; the server reopens this registration's spot with it.
  const resendInvite = async (memberId: string, name: string) => {
    if (!registration) return;
    setBusyAction(`resend:${memberId}`);
    try {
      const data = await adminRequest<{ message?: string }>(
        `/api/admin/team-registrations/${registration.id}/members/${memberId}/resend-invite`,
        { method: "POST" },
      );
      showToast({ tone: "success", title: `Invite sent again to ${name}`, description: data.message });
      await onChanged();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to send the invite again",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
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
                ["Payment", paymentStatusLabel(registration)],
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
                    Coaches are managed separately from the numbered player roster. Like players, a coach accepts an invite from their Quest account, and the registration only verifies once they have.
                  </p>
                  {registration.coach ? (
                    <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <StatusText value={registration.coach.inviteStatus} />
                      <p className="text-xs text-slate-400">
                        {COACH_INVITE_STATUS_HINTS[registration.coach.inviteStatus]}
                      </p>
                      {RESENDABLE_INVITE_STATUSES.has(registration.coach.inviteStatus) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busyAction !== null}
                          onClick={() => void resendInvite(registration.coach!.id, registration.coach!.name)}
                        >
                          {busyAction === `resend:${registration.coach.id}` ? "Sending..." : "Send invite again"}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
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
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <StatusText value={member.inviteStatus} />
                      {member.role !== "CAPTAIN" && RESENDABLE_INVITE_STATUSES.has(member.inviteStatus) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busyAction !== null}
                          onClick={() => void resendInvite(member.id, member.name)}
                        >
                          {busyAction === `resend:${member.id}` ? "Sending..." : "Send invite again"}
                        </Button>
                      ) : null}
                    </div>
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
