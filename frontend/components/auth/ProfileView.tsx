"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFormFields } from "@/hooks/useFormFields";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { fetchProfileTeams, type SavedTeam } from "@/lib/teams";

type ProfileFormState = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  discordTag: string;
};

type EmailChangeFormState = {
  newEmail: string;
  currentPassword: string;
};

type EmailChangeFieldName = "newEmail" | "currentPassword";
type EmailChangeFieldErrors = Partial<Record<EmailChangeFieldName, string>>;

const emptyForm: ProfileFormState = {
  firstName: "",
  lastName: "",
  username: "",
  email: "",
  phone: "",
  discordTag: "",
};

const formatMemberRole = (role: string, memberOrder: number) => {
  if (role === "CAPTAIN") {
    return "Captain";
  }

  if (role === "COACH") {
    return "Coach";
  }

  return `${role === "PLAYER" ? "Player" : "Substitute"} ${memberOrder}`;
};

export default function ProfileView() {
  const router = useRouter();
  const { user, refreshUser, logout, isLoading } = useAuth();
  const {
    fields: formData,
    handleFieldChange,
    resetFields,
  } = useFormFields<ProfileFormState>(emptyForm);
  const {
    fields: emailChangeData,
    handleFieldChange: handleEmailChangeField,
    resetFields: resetEmailChangeFields,
  } = useFormFields<EmailChangeFormState>({
    newEmail: "",
    currentPassword: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [emailChangeMessage, setEmailChangeMessage] = useState("");
  const [emailChangeError, setEmailChangeError] = useState("");
  const [emailChangeFieldErrors, setEmailChangeFieldErrors] =
    useState<EmailChangeFieldErrors>({});
  const [activeTab, setActiveTab] = useState<"account" | "teams">("account");
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }

    if (!user) {
      return;
    }

    resetFields({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      username: user.username || "",
      email: user.email || "",
      phone: user.phone || "",
      discordTag: user.discordTag || "",
    });
  }, [isLoading, resetFields, router, user]);

  useEffect(() => {
    let cancelled = false;

    const loadTeams = async () => {
      if (!user) {
        setTeams([]);
        setTeamsError("");
        return;
      }

      try {
        setTeamsLoading(true);
        setTeamsError("");
        const nextTeams = await fetchProfileTeams();

        if (cancelled) {
          return;
        }

        setTeams(nextTeams);
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load teams:", requestError);
        setTeamsError("Could not load your saved teams right now.");
      } finally {
        if (!cancelled) {
          setTeamsLoading(false);
        }
      }
    };

    void loadTeams();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isLoading) {
    return null;
  }

  if (!user) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await apiFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        json: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username,
          phone: formData.phone,
          discordTag: formData.discordTag,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || "Failed to update profile.");
        return;
      }

      refreshUser(data.user);
      setMessage("Profile updated successfully.");
    } catch (requestError) {
      console.error("Profile update failed:", requestError);
      setError("Something went wrong while updating your profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEmailChangeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsChangingEmail(true);
    setEmailChangeMessage("");
    setEmailChangeError("");

    const nextFieldErrors: EmailChangeFieldErrors = {};

    if (
      !emailChangeData.newEmail.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailChangeData.newEmail.trim())
    ) {
      nextFieldErrors.newEmail = "Please enter a valid email address.";
    }

    if (!emailChangeData.currentPassword) {
      nextFieldErrors.currentPassword = "Current password is required.";
    }

    setEmailChangeFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setIsChangingEmail(false);
      return;
    }

    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: typeof user;
        details?: {
          fieldErrors?: EmailChangeFieldErrors;
        };
      }>("/api/email-change/request", {
        method: "POST",
        json: {
          newEmail: emailChangeData.newEmail,
          currentPassword: emailChangeData.currentPassword,
        },
      });

      const errorMessage = getApiErrorMessage(
        response,
        data,
        "Failed to request email change."
      );

      if (errorMessage) {
        const serverFieldErrors = data.details?.fieldErrors ?? {};
        setEmailChangeFieldErrors(serverFieldErrors);
        setEmailChangeError(
          Object.keys(serverFieldErrors).length === 0 ? errorMessage : ""
        );
        return;
      }

      if (data.user) {
        refreshUser(data.user);
      }

      setEmailChangeFieldErrors({});
      setEmailChangeMessage(
        data.message ||
          "We sent a confirmation link to your new email address."
      );
      resetEmailChangeFields({
        newEmail: "",
        currentPassword: "",
      });
    } catch (requestError) {
      console.error("Email change request failed:", requestError);
      setEmailChangeError("Something went wrong while requesting the email change.");
    } finally {
      setIsChangingEmail(false);
    }
  };

  return (
    <section className="profile-section">
      <div className="form-container profile-layout">
        <div className="profile-summary">
          <span className="profile-badge">
            {user.role === "admin" ? "Admin Account" : "Player Account"}
          </span>
          <h2>
            {user.firstName} {user.lastName}
          </h2>
          <p className="profile-lead">
            You are logged in as <strong>{user.username}</strong>.
          </p>
          <div className="profile-meta">
            <p>
              <span>Email</span>
              {user.email}
            </p>
            <p>
              <span>Email Status</span>
              {user.emailVerified ? "Verified" : "Not verified"}
            </p>
          </div>
          {user.pendingEmail ? (
            <div className="auth-callout auth-callout-warning">
              <p>
                Email change pending for <strong>{user.pendingEmail}</strong>. Your
                current email stays active until you confirm the link sent to the new
                address.
              </p>
            </div>
          ) : null}
          {!user.emailVerified ? (
            <div className="auth-callout auth-callout-warning">
              <p>
                Verify your email before registering for tournaments. If you signed up
                with the wrong address, change it below first.
              </p>
              <ResendVerificationButton email={user.email} />
            </div>
          ) : null}
          <div className="profile-actions">
            {user.role === "admin" && (
              <>
                <Link href="/admin" className="btn btn-primary btn-small">
                  Open Admin Dashboard
                </Link>
                <Link href="/admin/users" className="btn btn-secondary btn-small">
                  Manage Users
                </Link>
              </>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={async () => {
                await logout();
                router.push("/");
              }}
            >
              Logout
            </button>
          </div>
        </div>

        <div className="profile-card">
          <div className="profile-tabs">
            <button
              type="button"
              className={`profile-tab ${activeTab === "account" ? "is-active" : ""}`}
              onClick={() => setActiveTab("account")}
            >
              Account
            </button>
            <button
              type="button"
              className={`profile-tab ${activeTab === "teams" ? "is-active" : ""}`}
              onClick={() => setActiveTab("teams")}
            >
              Teams
            </button>
          </div>

          {activeTab === "account" ? (
            <>
              <h3>Edit Profile</h3>
              <form className="profile-form" onSubmit={handleSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="firstName">First Name *</label>
                    <input
                      id="firstName"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleFieldChange}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="lastName">Last Name *</label>
                    <input
                      id="lastName"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleFieldChange}
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="username">Username *</label>
                    <input
                      id="username"
                      name="username"
                      value={formData.username}
                      onChange={handleFieldChange}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="email">Email</label>
                    <input id="email" name="email" value={formData.email} disabled />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="phone">Phone</label>
                    <input
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleFieldChange}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="discordTag">Discord Tag</label>
                    <input
                      id="discordTag"
                      name="discordTag"
                      value={formData.discordTag}
                      onChange={handleFieldChange}
                    />
                  </div>
                </div>

                {error && <p className="error-message">{error}</p>}
                {message && <p className="success-inline">{message}</p>}

                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
              </form>

              <div className="auth-divider" />

              <h3>Change Email</h3>
              <p className="profile-lead">
                Enter your new email and current password. We&apos;ll keep your
                existing email active until the new one is confirmed.
              </p>
              <form className="profile-form" onSubmit={handleEmailChangeSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="newEmail">New Email *</label>
                    <input
                      id="newEmail"
                      name="newEmail"
                      type="email"
                      value={emailChangeData.newEmail}
                      onChange={(event) => {
                        handleEmailChangeField(event);
                        const fieldName = event.target.name as EmailChangeFieldName;
                        setEmailChangeFieldErrors((currentErrors) => {
                          if (!currentErrors[fieldName]) {
                            return currentErrors;
                          }

                          const nextErrors = { ...currentErrors };
                          delete nextErrors[fieldName];
                          return nextErrors;
                        });
                      }}
                      aria-invalid={Boolean(emailChangeFieldErrors.newEmail)}
                      required
                    />
                    {emailChangeFieldErrors.newEmail ? (
                      <p className="field-error">{emailChangeFieldErrors.newEmail}</p>
                    ) : null}
                  </div>
                  <div className="form-group">
                    <label htmlFor="currentPassword">Current Password *</label>
                    <input
                      id="currentPassword"
                      name="currentPassword"
                      type="password"
                      value={emailChangeData.currentPassword}
                      onChange={(event) => {
                        handleEmailChangeField(event);
                        const fieldName = event.target.name as EmailChangeFieldName;
                        setEmailChangeFieldErrors((currentErrors) => {
                          if (!currentErrors[fieldName]) {
                            return currentErrors;
                          }

                          const nextErrors = { ...currentErrors };
                          delete nextErrors[fieldName];
                          return nextErrors;
                        });
                      }}
                      aria-invalid={Boolean(emailChangeFieldErrors.currentPassword)}
                      required
                    />
                    {emailChangeFieldErrors.currentPassword ? (
                      <p className="field-error">
                        {emailChangeFieldErrors.currentPassword}
                      </p>
                    ) : null}
                  </div>
                </div>

                {emailChangeError ? (
                  <p className="error-message">{emailChangeError}</p>
                ) : null}
                {emailChangeMessage ? (
                  <p className="success-inline">{emailChangeMessage}</p>
                ) : null}

                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={isChangingEmail}
                >
                  {isChangingEmail
                    ? "Sending..."
                    : user.pendingEmail
                      ? "Send New Confirmation"
                      : "Change Email"}
                </button>
              </form>
            </>
          ) : (
            <div className="profile-team-panel">
              <h3>Saved Teams</h3>
              <p className="profile-lead">
                Teams created during tournament registration appear here. Each added
                player receives an email invite they can accept or decline.
              </p>

              {teamsError ? <p className="error-message">{teamsError}</p> : null}
              {teamsLoading ? (
                <p className="profile-lead">Loading your teams...</p>
              ) : teams.length === 0 ? (
                <div className="auth-callout">
                  <p>
                    No saved teams yet. Register a tournament team to save it here for
                    future use.
                  </p>
                  <Link href="/tournament-registration" className="btn btn-primary btn-small">
                    Register a Team
                  </Link>
                </div>
              ) : (
                <div className="profile-team-list">
                  {teams.map((team) => (
                    <article key={team.id} className="profile-team-card">
                      <div className="profile-team-head">
                        <div>
                          <h4>{team.name}</h4>
                          <p>
                            Updated {new Date(team.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Link
                          href={`/tournament-registration?savedTeam=${team.id}`}
                          className="btn btn-secondary btn-small"
                        >
                          Reuse Team
                        </Link>
                      </div>
                      <div className="profile-team-members">
                        {team.members.map((member) => (
                          <div key={member.id} className="profile-team-member">
                            <div>
                              <strong>{member.name}</strong>
                              <p>{formatMemberRole(member.role, member.memberOrder)}</p>
                              <p>{member.email}</p>
                            </div>
                            <span
                              className={`status-chip status-chip-${member.inviteStatus}`}
                            >
                              {member.inviteStatus}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
