"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import {
  TeamRegistration,
  TournamentFormValues,
  adminRequest,
  buildTournamentFormData,
  initialTournamentFormValues,
} from "@/lib/admin";
import { Tournament } from "@/lib/tournaments";

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
});

export default function TournamentEditor({
  tournamentId,
}: {
  tournamentId?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(tournamentId);
  const [formValues, setFormValues] = useState<TournamentFormValues>(
    initialTournamentFormValues
  );
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEdit);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!tournamentId) {
      return;
    }

    const load = async () => {
      try {
        const data = await adminRequest<{
          tournament: Tournament & { registrations: TeamRegistration[] };
        }>(`/api/admin/tournaments/${tournamentId}`);
        setFormValues(mapTournamentToFormValues(data.tournament));
        setRegistrations(data.tournament.registrations || []);
        setSlugManuallyEdited(true);
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Unable to load tournament."
        );
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

    setFormValues((current) => ({
      ...current,
      slug: slugify(current.title),
    }));
  }, [formValues.title, slugManuallyEdited]);

  const updateField = <K extends keyof TournamentFormValues>(
    key: K,
    value: TournamentFormValues[K]
  ) => {
    setFormValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await adminRequest<{ tournament: Tournament }>(
        isEdit ? `/api/admin/tournaments/${tournamentId}` : "/api/admin/tournaments",
        {
          method: isEdit ? "PATCH" : "POST",
          body: buildTournamentFormData(formValues),
        }
      );

      setSuccessMessage(
        response.message ||
          (isEdit ? "Tournament updated successfully." : "Tournament created successfully.")
      );

      if (!isEdit) {
        router.push("/admin/tournaments");
        return;
      }

      setFormValues(mapTournamentToFormValues(response.tournament));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to save tournament."
      );
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
        <EmptyState description="Loading tournament..." />
      ) : (
        <>
          <div className="admin-users-card">
            <form className="admin-form-grid" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="title">Title *</label>
                <input
                  id="title"
                  value={formValues.title}
                  onChange={(event) => {
                    setSuccessMessage("");
                    updateField("title", event.target.value);
                  }}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="slug">Slug *</label>
                <input
                  id="slug"
                  value={formValues.slug}
                  onChange={(event) => {
                    setSuccessMessage("");
                    setSlugManuallyEdited(true);
                    updateField("slug", slugify(event.target.value));
                  }}
                  required
                />
                <small>Auto-generated from the title until you edit it manually.</small>
              </div>

              <div className="form-group">
                <label htmlFor="game">Game *</label>
                <input
                  id="game"
                  value={formValues.game}
                  onChange={(event) => updateField("game", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="status">Status *</label>
                <select
                  id="status"
                  value={formValues.status}
                  onChange={(event) =>
                    updateField("status", event.target.value as Tournament["status"])
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="registration_open">Registration Open</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="form-group admin-form-full">
                <label htmlFor="shortDescription">Short Description *</label>
                <textarea
                  id="shortDescription"
                  value={formValues.shortDescription}
                  onChange={(event) =>
                    updateField("shortDescription", event.target.value)
                  }
                  required
                />
              </div>

              <div className="form-group admin-form-full">
                <label htmlFor="fullDescription">Full Description *</label>
                <textarea
                  id="fullDescription"
                  value={formValues.fullDescription}
                  onChange={(event) =>
                    updateField("fullDescription", event.target.value)
                  }
                  required
                />
              </div>

              <div className="form-group admin-form-full">
                <label htmlFor="rules">Rules *</label>
                <textarea
                  id="rules"
                  value={formValues.rules}
                  onChange={(event) => updateField("rules", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="startDate">Start Date *</label>
                <input
                  id="startDate"
                  type="datetime-local"
                  value={formValues.startDate}
                  onChange={(event) => updateField("startDate", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="endDate">End Date *</label>
                <input
                  id="endDate"
                  type="datetime-local"
                  value={formValues.endDate}
                  onChange={(event) => updateField("endDate", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="registrationDeadline">Registration Deadline *</label>
                <input
                  id="registrationDeadline"
                  type="datetime-local"
                  value={formValues.registrationDeadline}
                  onChange={(event) =>
                    updateField("registrationDeadline", event.target.value)
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="format">Format *</label>
                <input
                  id="format"
                  value={formValues.format}
                  onChange={(event) => updateField("format", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="teamSize">Team Size *</label>
                <input
                  id="teamSize"
                  type="number"
                  min="1"
                  value={formValues.teamSize}
                  onChange={(event) => updateField("teamSize", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="maxTeams">Max Teams *</label>
                <input
                  id="maxTeams"
                  type="number"
                  min="1"
                  value={formValues.maxTeams}
                  onChange={(event) => updateField("maxTeams", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="prizePool">Prize Pool *</label>
                <input
                  id="prizePool"
                  value={formValues.prizePool}
                  onChange={(event) => updateField("prizePool", event.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="bracketLink">Bracket Link</label>
                <input
                  id="bracketLink"
                  type="url"
                  value={formValues.bracketLink}
                  onChange={(event) => updateField("bracketLink", event.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="contactLink">Discord / Contact Link</label>
                <input
                  id="contactLink"
                  type="url"
                  value={formValues.contactLink}
                  onChange={(event) => updateField("contactLink", event.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="bannerImage">Banner Image</label>
                <input
                  id="bannerImage"
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    updateField("bannerImage", event.target.files?.[0] || null)
                  }
                />
              </div>

              <div className="form-group admin-checkbox-stack">
                <label className="admin-inline-checkbox">
                  <input
                    type="checkbox"
                    checked={formValues.isPublished}
                    onChange={(event) =>
                      updateField("isPublished", event.target.checked)
                    }
                  />
                  Published / Visible
                </label>
                <label className="admin-inline-checkbox">
                  <input
                    type="checkbox"
                    checked={formValues.isFeatured}
                    onChange={(event) =>
                      updateField("isFeatured", event.target.checked)
                    }
                  />
                  Featured
                </label>
              </div>

              {error ? <p className="error-message admin-form-full">{error}</p> : null}
              {successMessage ? (
                <p className="success-inline admin-form-full">{successMessage}</p>
              ) : null}

              <div className="admin-table-actions admin-form-full">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving..." : isEdit ? "Save Tournament" : "Create Tournament"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => router.push("/admin/tournaments")}
                >
                  Back to Tournaments
                </button>
              </div>
            </form>
          </div>

          {isEdit ? (
            <div className="admin-users-card">
              <div className="admin-users-head">
                <div>
                  <h3>Registered Teams</h3>
                  <p>All registrations currently tied to this tournament.</p>
                </div>
              </div>

              {registrations.length === 0 ? (
                <EmptyState description="No teams have registered for this tournament yet." />
              ) : (
                <div className="admin-users-table-wrap">
                  <table className="admin-users-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Captain</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Verification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registrations.map((registration) => (
                        <tr key={registration.id}>
                          <td data-label="Team">{registration.teamName}</td>
                          <td data-label="Captain">{registration.captain.name}</td>
                          <td data-label="Status">{registration.status}</td>
                          <td data-label="Payment">{registration.paymentStatus}</td>
                          <td data-label="Verification">{registration.verificationStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
