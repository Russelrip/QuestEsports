"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminRecruitmentApplications } from "@/hooks/api/useAdmin";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToastStore } from "@/hooks/useToastStore";
import {
  adminRequest,
  downloadAdminFile,
  getAdminPaginationSummary,
  normalizeRecruitmentApplication,
  type RecruitmentApplication,
} from "@/lib/admin";

const applicationTypeLabels = {
  solo_player: "Solo Player",
  existing_team: "Existing Team",
  incomplete_team: "Incomplete Team",
};

export default function AdminRecruitmentManager() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [applicationType, setApplicationType] = useState("");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const debouncedSearch = useDebouncedValue(search);
  const { data, error, loading, refetch } = useAdminRecruitmentApplications(
    debouncedSearch,
    status,
    applicationType,
    page
  );
  const showToast = useToastStore((state) => state.showToast);
  const applications = (data?.applications || []).map(normalizeRecruitmentApplication);
  const pagination = data?.pagination;

  const buildExportPath = () => {
    const params = new URLSearchParams();
    const appendIfPresent = (key: string, value: string) => {
      const normalizedValue = value.trim();
      if (normalizedValue) {
        params.set(key, normalizedValue);
      }
    };

    appendIfPresent("search", search);
    appendIfPresent("status", status);
    appendIfPresent("applicationType", applicationType);

    const query = params.toString();
    return `/api/admin/recruitment-applications/export${query ? `?${query}` : ""}`;
  };

  const updateStatus = async (
    applicationId: string,
    nextStatus: RecruitmentApplication["status"]
  ) => {
    try {
      await adminRequest(`/api/admin/recruitment-applications/${applicationId}/status`, {
        method: "PATCH",
        json: { status: nextStatus },
      });
      showToast({ tone: "success", title: "Recruitment application updated" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update application",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  const deleteApplication = async (application: RecruitmentApplication) => {
    if (!window.confirm(`Delete the ${applicationTypeLabels[application.applicationType]} application for ${application.fullName}?`)) {
      return;
    }

    try {
      await adminRequest(`/api/admin/recruitment-applications/${application.id}`, {
        method: "DELETE",
      });
      showToast({ tone: "success", title: "Recruitment application deleted" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to delete application",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  const downloadApplications = async () => {
    setDownloading(true);

    try {
      await downloadAdminFile(buildExportPath(), "recruitment-applications.xlsx");
      showToast({ tone: "success", title: "Excel download started" });
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to download applications",
        description: nextError instanceof Error ? nextError.message : "Download failed.",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AdminShell
      title="Recruitment Applications"
      description="Review solo-player, team, and incomplete-roster applications submitted through Join Quest."
    >
      <Card className="p-6 sm:p-8">
        <div className="mb-6 grid gap-3 lg:grid-cols-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search applicant, team, game..."
          />
          <Select value={applicationType} onChange={(event) => setApplicationType(event.target.value)}>
            <option value="">All application types</option>
            <option value="solo_player">Solo Players</option>
            <option value="existing_team">Existing Teams</option>
            <option value="incomplete_team">Incomplete Teams</option>
          </Select>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Button
            type="button"
            variant="secondary"
            disabled={downloading}
            onClick={downloadApplications}
          >
            {downloading ? "Downloading..." : "Download Excel"}
          </Button>
        </div>

        {loading ? (
          <AdminTableSkeleton />
        ) : error ? (
          <EmptyState description={error} />
        ) : applications.length === 0 ? (
          <EmptyState description="No recruitment applications matched your filters." />
        ) : (
          <div className="grid gap-5">
            {applications.map((application) => (
              <article key={application.id} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>{applicationTypeLabels[application.applicationType]}</Badge>
                      <Badge>{application.status}</Badge>
                      {application.womensLeagueInterest ? <Badge>Women&apos;s League</Badge> : null}
                    </div>
                    <h3 className="mt-4 text-2xl text-white">{application.fullName}</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      Submitted {new Date(application.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(180px,240px)_auto] sm:items-end">
                    <label className="grid gap-2 text-sm text-slate-300">
                      Review Status
                      <Select
                        value={application.status}
                        onChange={(event) =>
                          updateStatus(
                            application.id,
                            event.target.value as RecruitmentApplication["status"]
                          )
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="accepted">Accepted</option>
                        <option value="rejected">Rejected</option>
                      </Select>
                    </label>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => deleteApplication(application)}
                    >
                      Delete Application
                    </Button>
                  </div>
                </div>

                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Email" value={application.email} />
                  <Detail label="WhatsApp" value={application.phone} />
                  <Detail label="Discord" value={application.discord} />
                  {application.nic ? <Detail label="NIC" value={application.nic} /> : null}
                  <Detail label="Primary Game" value={application.game} />
                  {application.playerId ? <Detail label="Player ID" value={application.playerId} /> : null}
                  {application.details.ign ? <Detail label="IGN" value={application.details.ign} /> : null}
                  {application.details.birthday ? <Detail label="Birthday" value={application.details.birthday} /> : null}
                  {application.details.gender ? <Detail label="Gender" value={application.details.gender} /> : null}
                  {application.details.peakAndCurrentRank ? <Detail label="Rank" value={application.details.peakAndCurrentRank} /> : null}
                  {typeof application.details.canAttendLan === "boolean" ? <Detail label="LAN Events" value={application.details.canAttendLan ? "Yes" : "No"} /> : null}
                  {typeof application.details.previouslyInOrganization === "boolean" ? <Detail label="Previous Org / Clan" value={application.details.previouslyInOrganization ? application.details.previousOrganization || "Yes" : "No"} /> : null}
                  {application.teamName ? <Detail label="Team Name" value={application.teamName} /> : null}
                  {application.currentRosterSize ? (
                    <Detail label="Roster Size" value={String(application.currentRosterSize)} />
                  ) : null}
                </dl>

                {application.notes ? (
                  <div className="mt-5 rounded-[20px] border border-white/8 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{application.notes}</p>
                  </div>
                ) : null}

                {application.details.tournamentExperience ? (
                  <div className="mt-5 rounded-[20px] border border-white/8 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tournament Experience / Achievements</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{application.details.tournamentExperience}</p>
                  </div>
                ) : null}

                {application.details.teamLogoUrl ? (
                  <p className="mt-5 text-sm text-slate-300">
                    Team logo: <a className="text-purple-200 hover:text-purple-100" href={application.details.teamLogoUrl} target="_blank" rel="noreferrer">Open link</a>
                  </p>
                ) : null}

                {application.details.additionalMembers ? (
                  <div className="mt-5 rounded-[20px] border border-white/8 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Additional Members</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{application.details.additionalMembers}</p>
                  </div>
                ) : null}

                {application.members.length > 0 ? (
                  <div className="mt-5">
                    <h4 className="text-lg text-white">Team Members</h4>
                    <div className="mt-3 grid gap-3">
                      {application.members.map((member, index) => (
                        <dl key={`${application.id}-${member.email}-${index}`} className="grid gap-3 rounded-[20px] border border-white/8 bg-black/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
                          <Detail label="Name" value={member.name} />
                          {member.ign ? <Detail label="IGN" value={member.ign} /> : null}
                          <Detail label="Email" value={member.email} />
                          <Detail label="Discord" value={member.discord} />
                          {member.playerId ? <Detail label="Player ID" value={member.playerId} /> : null}
                          {member.phone ? <Detail label="WhatsApp" value={member.phone} /> : null}
                          {member.role ? <Detail label="Role" value={member.role} /> : null}
                          {member.nic ? <Detail label="NIC" value={member.nic} /> : null}
                          <Detail label="Privacy Permission" value={member.privacyAcceptedAt ? new Date(member.privacyAcceptedAt).toLocaleString() : "Legacy record - not captured"} />
                        </dl>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}

            {pagination ? (
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination, "applications")}</p>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-200">{value}</dd>
    </div>
  );
}
