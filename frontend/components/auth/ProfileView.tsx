"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFormFields } from "@/hooks/useFormFields";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";

type ProfileFormState = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  discordTag: string;
};

const emptyForm: ProfileFormState = {
  firstName: "",
  lastName: "",
  username: "",
  email: "",
  phone: "",
  discordTag: "",
};

export default function ProfileView() {
  const router = useRouter();
  const { user, refreshUser, logout, isLoading } = useAuth();
  const {
    fields: formData,
    handleFieldChange,
    resetFields,
  } = useFormFields<ProfileFormState>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
          {!user.emailVerified ? (
            <div className="auth-callout auth-callout-warning">
              <p>Verify your email before registering for tournaments.</p>
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
        </div>
      </div>
    </section>
  );
}
