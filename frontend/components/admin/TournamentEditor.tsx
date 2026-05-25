"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
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
  type TeamRegistration,
  type TournamentFormValues,
  adminRequest,
  buildTournamentFormData,
  initialTournamentFormValues,
} from "@/lib/admin";
import { type Tournament } from "@/lib/tournaments";

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toLocalDateTimeValue = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

const mapTournamentToFormValues = (tournament: Tournament): TournamentFormValues => ({
  title: tournament.title,
  slug: tournament.slug,
  game: tournament.game,
  shortDescription: tournament.shortDescription,
  fullDescription: tournament.fullDescription,
  rules: tournament.rules || "",
  startDate: toLocalDateTimeValue(tournament.startDate),
  endDate: toLocalDateTimeValue(tournament.endDate),
  registrationDeadline: toLocalDateTimeValue(tournament.registrationDeadline),
  format: tournament.format,
  teamSize: String(tournament.teamSize),
  maxTeams: String(tournament.maxTeams),
  prizePool: tournament.prizePool,
  status: tournament.status,
  isPublished: tournament.isPublished,
  bracketLink: tournament.bracketLink || "",
  contactLink: tournament.contactLink || "",
  isFeatured: tournament.isFeatured,
  bannerImage: null,
  removeBannerImage: false,
});

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function TournamentEditor({ tournamentId }: { tournamentId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(tournamentId);
  const [formValues, setFormValues] = useState<TournamentFormValues>(initialTournamentFormValues);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEdit);
  const hydratedRef = useRef(false);
  const bannerImageInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToastStore((state) => state.showToast);

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
        setSlugManuallyEdited(true);
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
              <FormField label="Team Size" htmlFor="teamSize" required>
                <Input id="teamSize" type="number" min="1" value={formValues.teamSize} onChange={(event) => updateField("teamSize", event.target.value)} required />
              </FormField>
              <FormField label="Max Teams" htmlFor="maxTeams" required>
                <Input id="maxTeams" type="number" min="1" value={formValues.maxTeams} onChange={(event) => updateField("maxTeams", event.target.value)} required />
              </FormField>
              <FormField label="Prize Pool" htmlFor="prizePool" required>
                <Input id="prizePool" value={formValues.prizePool} onChange={(event) => updateField("prizePool", event.target.value)} required />
              </FormField>
              <FormField label="Start Date" htmlFor="startDate" required>
                <Input id="startDate" type="datetime-local" value={formValues.startDate} onChange={(event) => updateField("startDate", event.target.value)} required />
              </FormField>
              <FormField label="End Date" htmlFor="endDate" required>
                <Input id="endDate" type="datetime-local" value={formValues.endDate} onChange={(event) => updateField("endDate", event.target.value)} required />
              </FormField>
              <FormField label="Registration Deadline" htmlFor="registrationDeadline" required>
                <Input id="registrationDeadline" type="datetime-local" value={formValues.registrationDeadline} onChange={(event) => updateField("registrationDeadline", event.target.value)} required />
              </FormField>
              <FormField label="Bracket Link" htmlFor="bracketLink">
                <Input id="bracketLink" type="url" value={formValues.bracketLink} onChange={(event) => updateField("bracketLink", event.target.value)} />
              </FormField>
              <FormField label="Discord / Contact Link" htmlFor="contactLink">
                <Input id="contactLink" type="url" value={formValues.contactLink} onChange={(event) => updateField("contactLink", event.target.value)} />
              </FormField>
              <FormField label="Banner Image" htmlFor="bannerImage" hint="Upload a tournament banner (PNG, JPG, or WebP)">
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
              {isEdit ? (
                <div className="md:col-span-2 xl:col-span-3 rounded-[24px] border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/20 bg-black/30 accent-cyan-300"
                      checked={formValues.removeBannerImage}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        updateField("removeBannerImage", checked);
                        if (checked) {
                          updateField("bannerImage", null);
                          if (bannerImageInputRef.current) {
                            bannerImageInputRef.current.value = "";
                          }
                        }
                      }}
                    />
                    Remove current banner image
                  </label>
                </div>
              ) : null}
              <FormField label="Short Description" htmlFor="shortDescription" required className="md:col-span-2 xl:col-span-3">
                <Textarea id="shortDescription" value={formValues.shortDescription} onChange={(event) => updateField("shortDescription", event.target.value)} required />
              </FormField>
              <FormField label="Full Description" htmlFor="fullDescription" required className="md:col-span-2 xl:col-span-3">
                <Textarea id="fullDescription" value={formValues.fullDescription} onChange={(event) => updateField("fullDescription", event.target.value)} required />
              </FormField>
              <FormField label="Rules" htmlFor="rules" required className="md:col-span-2 xl:col-span-3">
                <Textarea id="rules" value={formValues.rules} onChange={(event) => updateField("rules", event.target.value)} required />
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
