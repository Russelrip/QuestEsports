"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToastStore } from "@/hooks/useToastStore";
import {
  fetchUserStaffPermissions,
  updateUserStaffPermissions,
  type StaffPermission,
  type UserStaffPermissions,
} from "@/lib/staff-permissions";

// Grants individual admin areas to a user who is not an admin. Admins already
// open every area, so for them this only explains that.
export default function AdminUserStaffAccess({
  userId,
  username,
  isAdmin,
  onSaved,
}: {
  userId: string;
  username: string;
  isAdmin: boolean;
  onSaved?: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [data, setData] = useState<UserStaffPermissions | null>(null);
  const [selected, setSelected] = useState<StaffPermission[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    fetchUserStaffPermissions(userId)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setSelected(next.permissions);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Could not load staff access.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const saved = data?.permissions ?? [];
  const dirty = selected.length !== saved.length || selected.some((key) => !saved.includes(key));

  const toggle = (key: StaffPermission, checked: boolean) => {
    setSelected((current) => (checked ? [...current, key] : current.filter((entry) => entry !== key)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateUserStaffPermissions(userId, selected);
      setData(next);
      setSelected(next.permissions);
      onSaved?.();
      showToast({ tone: "success", title: "Staff access saved", description: `@${username} can now open ${next.permissions.length === 0 ? "no admin areas" : `${next.permissions.length} admin area${next.permissions.length === 1 ? "" : "s"}`}.` });
    } catch (nextError) {
      showToast({ tone: "error", title: "Unable to save staff access", description: nextError instanceof Error ? nextError.message : "Request failed." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-5 flex flex-col gap-2">
        <h3 className="text-2xl text-white">Staff Access</h3>
        <p className="text-sm text-slate-400">
          Let @{username} manage specific areas of the admin panel without making them an admin. They see only the areas
          ticked here.
        </p>
      </div>

      {isAdmin ? (
        <p className="text-sm text-slate-300">@{username} is an admin and can already open every area.</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-200">{error}</p>
      ) : !data ? (
        <p className="text-sm text-slate-400">Loading staff access…</p>
      ) : (
        <div className="grid gap-5">
          <fieldset className="grid gap-3">
            <legend className="sr-only">Admin areas for @{username}</legend>
            {data.catalog.map((area) => (
              <label key={area.key} className="flex min-w-0 items-start gap-3 border border-white/8 bg-white/5 p-4 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(area.key)}
                  disabled={saving}
                  onChange={(event) => toggle(area.key, event.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-white">{area.label}</span>
                  <span className="block text-slate-400">{area.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? "Saving..." : "Save staff access"}
            </Button>
            {dirty ? (
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setSelected(saved)}>
                Discard changes
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
