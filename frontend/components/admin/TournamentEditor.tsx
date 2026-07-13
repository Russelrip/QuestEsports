"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import {
  AssetRemovalCheckbox,
  BracketAdminPanel,
  FileUploadField,
} from "@/components/admin/TournamentEditorSupport";
import {
  formatFileSize,
  mapTournamentToFormValues,
  slugify,
} from "@/components/admin/tournament-editor-model";
import EmptyState from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useToastStore } from "@/hooks/useToastStore";
import {
  type AdminTournamentBracket,
  type TeamRegistration,
  type TournamentFormValues,
  adminRequest,
  buildTournamentFormData,
  initialTournamentFormValues,
} from "@/lib/admin";
import { type Tournament } from "@/lib/tournaments";

export default function TournamentEditor({ tournamentId }: { tournamentId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(tournamentId);
  const [formValues, setFormValues] = useState<TournamentFormValues>(initialTournamentFormValues);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [bracket, setBracket] = useState<AdminTournamentBracket | null>(null);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [rulebooks, setRulebooks] = useState<Array<{ id: string; title: string; game: string; variant: string }>>([]);
  const [eventSeries, setEventSeries] = useState<Array<{ id: string; title: string }>>([]);
  const [assetPreview, setAssetPreview] = useState<{
    bannerUrl: string | null;
    completedPosterUrl: string | null;
    firstPlaceUrl: string | null;
    secondPlaceUrl: string | null;
    thirdPlaceUrl: string | null;
    scheduleRows: number;
  }>({
    bannerUrl: null,
    completedPosterUrl: null,
    firstPlaceUrl: null,
    secondPlaceUrl: null,
    thirdPlaceUrl: null,
    scheduleRows: 0,
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEdit);
  const hydratedRef = useRef(false);
  const bannerImageInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    const loadRulebooks = async () => {
      try {
        const data = await adminRequest<{ rulebooks: Array<{ id: string; title: string; game: string; variant: string }> }>("/api/rulebooks");
        setRulebooks(data.rulebooks);
      } catch {
        setRulebooks([]);
      }
    };
    void loadRulebooks();
  }, []);

  useEffect(() => {
    void adminRequest<{ series: Array<{ id: string; title: string }> }>("/api/admin/event-series")
      .then((data) => setEventSeries(data.series))
      .catch(() => setEventSeries([]));
  }, []);

  useEffect(() => {
    if (!tournamentId) {
      return;
    }

    const load = async () => {
      try {
        const data = await adminRequest<{ tournament: Tournament & { registrations: TeamRegistration[] } }>(
          `/api/admin/tournaments/${tournamentId}`
        );
        setFormValues(mapTournamentToFormValues(data.tournament));
        setRegistrations(data.tournament.registrations || []);
        setAssetPreview({
          bannerUrl: data.tournament.bannerUrl,
          completedPosterUrl: data.tournament.showcase?.posterUrl || null,
          firstPlaceUrl: data.tournament.showcase?.firstPlaceUrl || null,
          secondPlaceUrl: data.tournament.showcase?.secondPlaceUrl || null,
          thirdPlaceUrl: data.tournament.showcase?.thirdPlaceUrl || null,
          scheduleRows: data.tournament.scheduleData?.rows?.length || 0,
        });
        setSlugManuallyEdited(true);

        const bracketData = await adminRequest<{ bracket: AdminTournamentBracket | null }>(
          `/api/admin/tournaments/${tournamentId}/bracket`
        );
        setBracket(bracketData.bracket);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to load tournament.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [tournamentId]);

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }

    if (slugManuallyEdited) {
      return;
    }

    setFormValues((current) => ({ ...current, slug: slugify(current.title) }));
  }, [formValues.title, slugManuallyEdited]);

  const updateField = <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) => {
    setFormValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await adminRequest<{ tournament: Tournament }>(
        isEdit ? `/api/admin/tournaments/${tournamentId}` : "/api/admin/tournaments",
        { method: isEdit ? "PATCH" : "POST", body: buildTournamentFormData(formValues) }
      );

      showToast({
        tone: "success",
        title: isEdit ? "Tournament updated" : "Tournament created",
        description: response.message,
      });

      if (!isEdit) {
        router.push("/admin/tournaments");
        return;
      }

      setFormValues(mapTournamentToFormValues(response.tournament));
      setAssetPreview({
        bannerUrl: response.tournament.bannerUrl,
        completedPosterUrl: response.tournament.showcase?.posterUrl || null,
        firstPlaceUrl: response.tournament.showcase?.firstPlaceUrl || null,
        secondPlaceUrl: response.tournament.showcase?.secondPlaceUrl || null,
        thirdPlaceUrl: response.tournament.showcase?.thirdPlaceUrl || null,
        scheduleRows: response.tournament.scheduleData?.rows?.length || 0,
      });
      if (bannerImageInputRef.current) {
        bannerImageInputRef.current.value = "";
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to save tournament.";
      setError(message);
      showToast({ tone: "error", title: "Unable to save tournament", description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title={isEdit ? "Edit Tournament" : "Create Tournament"}
      description={
        isEdit
          ? "Update tournament content, publish state, schedule, and registration settings."
          : "Create a new tournament that can later be published on the public site."
      }
    >
      {loading ? (
        <AdminTableSkeleton rows={6} />
      ) : (
        <>
          <Card className="p-6 sm:p-8">
            <form className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" onSubmit={handleSubmit}>
              <FormField label="Title" htmlFor="title" required className="xl:col-span-2">
                <Input id="title" value={formValues.title} onChange={(event) => updateField("title", event.target.value)} required />
              </FormField>
              <FormField label="Slug" htmlFor="slug" hint="Auto-generated from the title until you edit it manually." required>
                <Input
                  id="slug"
                  value={formValues.slug}
                  onChange={(event) => {
                    setSlugManuallyEdited(true);
                    updateField("slug", slugify(event.target.value));
                  }}
                  required
                />
              </FormField>
              <FormField label="Game" htmlFor="game" required>
                <Input id="game" value={formValues.game} onChange={(event) => updateField("game", event.target.value)} required />
              </FormField>
              <FormField label="Display Priority" htmlFor="displayPriority" hint="Lower numbers appear first." required>
                <Input
                  id="displayPriority"
                  type="number"
                  min="0"
                  value={formValues.displayPriority}
                  onChange={(event) => updateField("displayPriority", event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Status" htmlFor="status" required>
                <Select id="status" value={formValues.status} onChange={(event) => updateField("status", event.target.value as Tournament["status"])}>
                  <option value="draft">Draft</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="registration_open">Registration Open</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </FormField>
              <FormField label="Format" htmlFor="format" required>
                <Input id="format" value={formValues.format} onChange={(event) => updateField("format", event.target.value)} required />
              </FormField>
              <FormField label="Registration Mode" htmlFor="registrationMode" required>
                <Select
                  id="registrationMode"
                  value={formValues.registrationMode}
                  onChange={(event) => updateField("registrationMode", event.target.value as Tournament["registrationMode"])}
                >
                  <option value="open_entry">Open Entry</option>
                  <option value="slot_based">Slot Based</option>
                </Select>
              </FormField>
              <FormField label="Entry Type" htmlFor="entryType" required>
                <Select id="entryType" value={formValues.entryType} onChange={(event) => updateField("entryType", event.target.value as Tournament["entryType"])}>
                  <option value="team">Team</option>
                  <option value="solo">Solo player</option>
                </Select>
              </FormField>
              <FormField label="Event Series" htmlFor="seriesId" hint="Optional parent event such as Quest Ascension.">
                <Select id="seriesId" value={formValues.seriesId} onChange={(event) => updateField("seriesId", event.target.value)}>
                  <option value="">Standalone tournament</option>
                  {eventSeries.map((series) => <option key={series.id} value={series.id}>{series.title}</option>)}
                </Select>
              </FormField>
              <FormField label="Series Order" htmlFor="seriesOrder">
                <Input id="seriesOrder" type="number" value={formValues.seriesOrder} onChange={(event) => updateField("seriesOrder", event.target.value)} />
              </FormField>
              <FormField label="Team Size" htmlFor="teamSize" required>
                <Input id="teamSize" type="number" min="1" value={formValues.teamSize} onChange={(event) => updateField("teamSize", event.target.value)} required />
              </FormField>
              <FormField label="Minimum Roster" htmlFor="minRosterSize" required>
                <Input id="minRosterSize" type="number" min="1" value={formValues.minRosterSize} onChange={(event) => updateField("minRosterSize", event.target.value)} required />
              </FormField>
              <FormField label="Maximum Main Roster" htmlFor="maxRosterSize" required>
                <Input id="maxRosterSize" type="number" min="1" value={formValues.maxRosterSize} onChange={(event) => updateField("maxRosterSize", event.target.value)} required />
              </FormField>
              <FormField label="Maximum Substitutes" htmlFor="maxSubstitutes" required>
                <Input id="maxSubstitutes" type="number" min="0" value={formValues.maxSubstitutes} onChange={(event) => updateField("maxSubstitutes", event.target.value)} required />
              </FormField>
              <FormField label="Max Teams" htmlFor="maxTeams" required>
                <Input id="maxTeams" type="number" min="1" value={formValues.maxTeams} onChange={(event) => updateField("maxTeams", event.target.value)} required />
              </FormField>
              <FormField label="Prize Pool" htmlFor="prizePool" required>
                <Input id="prizePool" value={formValues.prizePool} onChange={(event) => updateField("prizePool", event.target.value)} required />
              </FormField>
              <FormField label="Registration Fee" htmlFor="registrationFeeAmount" hint="Use 0 for free registration.">
                <Input id="registrationFeeAmount" type="number" min="0" step="0.01" value={formValues.registrationFeeAmount} onChange={(event) => updateField("registrationFeeAmount", event.target.value)} />
              </FormField>
              <FormField label="Fee Currency" htmlFor="registrationFeeCurrency">
                <Select id="registrationFeeCurrency" value={formValues.registrationFeeCurrency} onChange={(event) => updateField("registrationFeeCurrency", event.target.value)}>
                  <option value="LKR">LKR</option><option value="USD">USD</option>
                </Select>
              </FormField>
              <FormField label="Payment Reservation (minutes)" htmlFor="reservationMinutes">
                <Input id="reservationMinutes" type="number" min="1" value={formValues.reservationMinutes} onChange={(event) => updateField("reservationMinutes", event.target.value)} />
              </FormField>
              <FormField label="Configurable Registration Fields" htmlFor="registrationFields" hint='JSON list. Example: [{"key":"pubg-mobile-id","label":"PUBG Mobile ID","type":"text","scope":"entry","required":true,"options":[]}]' className="md:col-span-2 xl:col-span-3">
                <Textarea id="registrationFields" rows={8} value={formValues.registrationFields} onChange={(event) => updateField("registrationFields", event.target.value)} />
              </FormField>
              <FormField label="Start Date" htmlFor="startDateStatus" required>
                <div className="grid gap-2">
                  <Select id="startDateStatus" value={formValues.startDateStatus} onChange={(event) => updateField("startDateStatus", event.target.value as TournamentFormValues["startDateStatus"])}>
                    <option value="scheduled">Scheduled date</option>
                    <option value="tba">TBA</option>
                    <option value="tbd">TBD</option>
                  </Select>
                  {formValues.startDateStatus === "scheduled" ? (
                    <Input id="startDate" type="datetime-local" value={formValues.startDate} onChange={(event) => updateField("startDate", event.target.value)} required />
                  ) : null}
                </div>
              </FormField>
              <FormField label="End Date" htmlFor="endDateStatus" required>
                <div className="grid gap-2">
                  <Select id="endDateStatus" value={formValues.endDateStatus} onChange={(event) => updateField("endDateStatus", event.target.value as TournamentFormValues["endDateStatus"])}>
                    <option value="scheduled">Scheduled date</option>
                    <option value="tba">TBA</option>
                    <option value="tbd">TBD</option>
                  </Select>
                  {formValues.endDateStatus === "scheduled" ? (
                    <Input id="endDate" type="datetime-local" value={formValues.endDate} onChange={(event) => updateField("endDate", event.target.value)} required />
                  ) : null}
                </div>
              </FormField>
              <FormField label="Registration Deadline" htmlFor="registrationDeadlineStatus" required>
                <div className="grid gap-2">
                  <Select id="registrationDeadlineStatus" value={formValues.registrationDeadlineStatus} onChange={(event) => updateField("registrationDeadlineStatus", event.target.value as TournamentFormValues["registrationDeadlineStatus"])}>
                    <option value="scheduled">Scheduled date</option>
                    <option value="tba">TBA</option>
                    <option value="tbd">TBD</option>
                  </Select>
                  {formValues.registrationDeadlineStatus === "scheduled" ? (
                    <Input id="registrationDeadline" type="datetime-local" value={formValues.registrationDeadline} onChange={(event) => updateField("registrationDeadline", event.target.value)} required />
                  ) : null}
                </div>
              </FormField>
              <FormField label="Registration Opens" htmlFor="registrationOpenAt" hint="Optional public schedule start.">
                <Input id="registrationOpenAt" type="datetime-local" value={formValues.registrationOpenAt} onChange={(event) => updateField("registrationOpenAt", event.target.value)} />
              </FormField>
              <FormField label="Bracket Link" htmlFor="bracketLink">
                <Input id="bracketLink" type="url" value={formValues.bracketLink} onChange={(event) => updateField("bracketLink", event.target.value)} />
              </FormField>
              <FormField label="Discord / Contact Link" htmlFor="contactLink">
                <Input id="contactLink" type="url" value={formValues.contactLink} onChange={(event) => updateField("contactLink", event.target.value)} />
              </FormField>
              <FormField label="Tournament Rulebook" htmlFor="rulebookId" hint="Select a reusable rulebook created in the Rulebooks admin page.">
                <Select id="rulebookId" value={formValues.rulebookId} onChange={(event) => updateField("rulebookId", event.target.value)}>
                  <option value="">No rulebook attached</option>
                  {rulebooks
                    .filter((rulebook) => rulebook.game.toLowerCase() === formValues.game.trim().toLowerCase())
                    .map((rulebook) => (
                    <option key={rulebook.id} value={rulebook.id}>
                      {rulebook.variant} - {rulebook.title}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Banner Image" htmlFor="bannerImage" hint="Upload a PNG, JPG, or WebP tournament banner up to 10 MB.">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <input
                    ref={bannerImageInputRef}
                    id="bannerImage"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] || null;
                      updateField("bannerImage", nextFile);
                      if (nextFile) {
                        updateField("removeBannerImage", false);
                      }
                    }}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {formValues.bannerImage ? formValues.bannerImage.name : "No banner selected"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formValues.bannerImage
                          ? `${formatFileSize(formValues.bannerImage.size)} selected`
                          : "PNG, JPG, or WebP recommended"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {formValues.bannerImage ? (
                        <button
                          type="button"
                          className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
                          onClick={() => {
                            updateField("bannerImage", null);
                            if (bannerImageInputRef.current) {
                              bannerImageInputRef.current.value = "";
                            }
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                      <label
                        htmlFor="bannerImage"
                        className="cursor-pointer rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-400/15"
                      >
                        Choose Banner
                      </label>
                    </div>
                  </div>
                </div>
              </FormField>
              <FormField label="Schedule File" htmlFor="scheduleFile" hint="Upload XLSX or CSV up to 10 MB to render the schedule automatically.">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <Input
                    id="scheduleFile"
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={(event) => {
                      updateField("scheduleFile", event.target.files?.[0] || null);
                      if (event.target.files?.[0]) {
                        updateField("removeScheduleFile", false);
                      }
                    }}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    {formValues.scheduleFile
                      ? `${formValues.scheduleFile.name} selected`
                      : assetPreview.scheduleRows > 0
                        ? `${assetPreview.scheduleRows} schedule rows currently available`
                        : "No schedule uploaded yet"}
                  </p>
                </div>
              </FormField>
              <FormField label="Completed Poster" htmlFor="completedPosterImage" hint="Official poster shown first in completed showcase (max 10 MB).">
                <FileUploadField
                  id="completedPosterImage"
                  accept="image/png,image/jpeg,image/webp"
                  file={formValues.completedPosterImage}
                  existingUrl={assetPreview.completedPosterUrl}
                  onChange={(file) => {
                    updateField("completedPosterImage", file);
                    if (file) {
                      updateField("removeCompletedPosterImage", false);
                    }
                  }}
                />
              </FormField>
              <FormField label="1st Place Image" htmlFor="firstPlaceImage" hint="Maximum file size: 10 MB.">
                <FileUploadField
                  id="firstPlaceImage"
                  accept="image/png,image/jpeg,image/webp"
                  file={formValues.firstPlaceImage}
                  existingUrl={assetPreview.firstPlaceUrl}
                  onChange={(file) => {
                    updateField("firstPlaceImage", file);
                    if (file) {
                      updateField("removeFirstPlaceImage", false);
                    }
                  }}
                />
              </FormField>
              <FormField label="2nd Place Image" htmlFor="secondPlaceImage" hint="Maximum file size: 10 MB.">
                <FileUploadField
                  id="secondPlaceImage"
                  accept="image/png,image/jpeg,image/webp"
                  file={formValues.secondPlaceImage}
                  existingUrl={assetPreview.secondPlaceUrl}
                  onChange={(file) => {
                    updateField("secondPlaceImage", file);
                    if (file) {
                      updateField("removeSecondPlaceImage", false);
                    }
                  }}
                />
              </FormField>
              <FormField label="3rd Place Image" htmlFor="thirdPlaceImage" hint="Maximum file size: 10 MB.">
                <FileUploadField
                  id="thirdPlaceImage"
                  accept="image/png,image/jpeg,image/webp"
                  file={formValues.thirdPlaceImage}
                  existingUrl={assetPreview.thirdPlaceUrl}
                  onChange={(file) => {
                    updateField("thirdPlaceImage", file);
                    if (file) {
                      updateField("removeThirdPlaceImage", false);
                    }
                  }}
                />
              </FormField>
              {isEdit ? (
                <div className="md:col-span-2 xl:col-span-3 rounded-[24px] border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <AssetRemovalCheckbox
                      label="Remove current banner image"
                      checked={formValues.removeBannerImage}
                      onChange={(checked) => {
                        updateField("removeBannerImage", checked);
                        if (checked) {
                          updateField("bannerImage", null);
                          if (bannerImageInputRef.current) {
                            bannerImageInputRef.current.value = "";
                          }
                        }
                      }}
                    />
                    <AssetRemovalCheckbox
                      label="Remove schedule file"
                      checked={formValues.removeScheduleFile}
                      onChange={(checked) => updateField("removeScheduleFile", checked)}
                    />
                    <AssetRemovalCheckbox
                      label="Remove completed poster"
                      checked={formValues.removeCompletedPosterImage}
                      onChange={(checked) => updateField("removeCompletedPosterImage", checked)}
                    />
                    <AssetRemovalCheckbox
                      label="Remove 1st place image"
                      checked={formValues.removeFirstPlaceImage}
                      onChange={(checked) => updateField("removeFirstPlaceImage", checked)}
                    />
                    <AssetRemovalCheckbox
                      label="Remove 2nd place image"
                      checked={formValues.removeSecondPlaceImage}
                      onChange={(checked) => updateField("removeSecondPlaceImage", checked)}
                    />
                    <AssetRemovalCheckbox
                      label="Remove 3rd place image"
                      checked={formValues.removeThirdPlaceImage}
                      onChange={(checked) => updateField("removeThirdPlaceImage", checked)}
                    />
                  </div>
                </div>
              ) : null}
              <FormField label="Short Description" htmlFor="shortDescription" required className="md:col-span-2 xl:col-span-3">
                <Textarea id="shortDescription" value={formValues.shortDescription} onChange={(event) => updateField("shortDescription", event.target.value)} required />
              </FormField>
              <FormField label="Full Description" htmlFor="fullDescription" required className="md:col-span-2 xl:col-span-3">
                <Textarea id="fullDescription" value={formValues.fullDescription} onChange={(event) => updateField("fullDescription", event.target.value)} required />
              </FormField>
              <div className="md:col-span-2 xl:col-span-3 flex flex-wrap gap-6 rounded-[24px] border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={formValues.isPublished} onChange={(event) => updateField("isPublished", event.target.checked)} />
                  Published / Visible
                </label>
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={formValues.isFeatured} onChange={(event) => updateField("isFeatured", event.target.checked)} />
                  Featured
                </label>
              </div>
              {error ? <p className="md:col-span-2 xl:col-span-3 text-sm text-rose-300">{error}</p> : null}
              <div className="md:col-span-2 xl:col-span-3 flex flex-wrap gap-3">
                <Button type="submit" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Tournament" : "Create Tournament"}</Button>
                <Button type="button" variant="secondary" onClick={() => router.push("/admin/tournaments")}>Back to Tournaments</Button>
              </div>
            </form>
          </Card>

          {isEdit ? (
            <BracketAdminPanel
              tournamentId={tournamentId || ""}
              bracket={bracket}
              busy={bracketBusy}
              onBusyChange={setBracketBusy}
              onBracketChange={setBracket}
            />
          ) : null}

          {isEdit ? (
            <Card className="p-6 sm:p-8">
              <div className="mb-6">
                <h3 className="text-2xl text-white">Registered Teams</h3>
                <p className="text-sm text-slate-400">All registrations currently tied to this tournament.</p>
              </div>
              {registrations.length === 0 ? (
                <EmptyState description="No teams have registered for this tournament yet." />
              ) : (
                <div className="grid gap-4">
                  {registrations.map((registration) => (
                    <div key={registration.id} className="grid gap-3 rounded-[24px] border border-white/8 bg-white/5 p-4 md:grid-cols-4">
                      <div>
                        <p className="font-medium text-white">{registration.teamName}</p>
                        <p className="text-sm text-slate-400">{registration.captain.name}</p>
                      </div>
                      <p className="text-sm text-slate-400">Status: <span className="text-white">{registration.status}</span></p>
                      <p className="text-sm text-slate-400">Payment: <span className="text-white">{registration.paymentStatus}</span></p>
                      <p className="text-sm text-slate-400">Verification: <span className="text-white">{registration.verificationStatus}</span></p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
