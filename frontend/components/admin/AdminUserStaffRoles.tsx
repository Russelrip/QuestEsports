"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToastStore } from "@/hooks/useToastStore";
import {
  DEFAULT_ROLE_COLOR,
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_KEYS,
  fetchStaffRoles,
  fetchUserStaffRoles,
  updateUserStaffRoles,
  type StaffRole,
} from "@/lib/staff-permissions";

export function StaffRoleChip({
  name,
  color,
  onRemove,
  disabled,
}: {
  name: string;
  color: string | null;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/6 py-0.5 pl-2 pr-2 text-xs text-slate-100">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? DEFAULT_ROLE_COLOR }} />
      <span className="truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          className="-mr-1 ml-0.5 rounded-full px-1 leading-none text-slate-400 hover:text-white disabled:opacity-40"
          aria-label={`Remove ${name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

// The staff roles a user holds, like the role list on a Discord member. A super
// admin adds and removes roles here and each change saves straight away; every
// other admin sees the roles read-only.
export default function AdminUserStaffRoles({
  userId,
  username,
  isAdmin,
  canManage,
  onSaved,
}: {
  userId: string;
  username: string;
  isAdmin: boolean;
  canManage: boolean;
  onSaved?: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [allRoles, setAllRoles] = useState<StaffRole[] | null>(null);
  const [held, setHeld] = useState<StaffRole[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAllRoles(null);
    setHeld(null);
    setError("");
    Promise.all([fetchStaffRoles(), fetchUserStaffRoles(userId)])
      .then(([roles, userRoles]) => {
        if (cancelled) return;
        setAllRoles(roles);
        setHeld(userRoles);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Could not load staff roles.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const available = useMemo(
    () => (allRoles ?? []).filter((role) => !(held ?? []).some((holding) => holding.id === role.id)),
    [allRoles, held]
  );

  const areas = useMemo(() => {
    const granted = new Set((held ?? []).flatMap((role) => role.permissions));
    return STAFF_PERMISSION_KEYS.filter((key) => granted.has(key));
  }, [held]);

  const save = async (roleIds: string[], success: string) => {
    setSaving(true);
    try {
      setHeld(await updateUserStaffRoles(userId, roleIds));
      onSaved?.();
      showToast({ tone: "success", title: "Roles updated", description: success });
    } catch (nextError) {
      showToast({ tone: "error", title: "Unable to update roles", description: nextError instanceof Error ? nextError.message : "Request failed." });
    } finally {
      setSaving(false);
    }
  };

  const addRole = (roleId: string) => {
    const role = allRoles?.find((candidate) => candidate.id === roleId);
    if (!role || !held) return;
    void save([...held.map((holding) => holding.id), role.id], `@${username} now has ${role.name}.`);
  };

  const removeRole = (role: StaffRole) => {
    if (!held) return;
    void save(held.filter((holding) => holding.id !== role.id).map((holding) => holding.id), `@${username} no longer has ${role.name}.`);
  };

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-5 flex flex-col gap-2">
        <h3 className="text-2xl text-white">Roles</h3>
        <p className="text-sm text-slate-400">
          Roles decide which admin areas @{username} can open, like roles on Discord.{" "}
          <Link href="/admin/roles" className="text-violet-200 underline-offset-2 hover:underline">Manage roles</Link>
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-200">{error}</p>
      ) : !held || !allRoles ? (
        <p className="text-sm text-slate-400">Loading roles…</p>
      ) : (
        <div className="grid gap-4">
          {isAdmin ? (
            <p className="text-sm text-slate-300">
              @{username} is an admin and can already open every area. Roles only take effect if admin access is removed.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2" aria-label={`Roles held by @${username}`}>
            {held.length === 0 ? <span className="text-sm text-slate-400">No roles.</span> : null}
            {held.map((role) => (
              <StaffRoleChip
                key={role.id}
                name={role.name}
                color={role.color}
                disabled={saving}
                onRemove={canManage ? () => removeRole(role) : undefined}
              />
            ))}
          </div>

          {canManage ? (
            allRoles.length === 0 ? (
              <p className="text-sm text-slate-400">
                No roles exist yet. <Link href="/admin/roles" className="text-violet-200 hover:underline">Create one</Link> first.
              </p>
            ) : available.length > 0 ? (
              <div className="max-w-xs">
                <Select
                  aria-label="Add a role"
                  value=""
                  disabled={saving}
                  onChange={(event) => addRole(event.target.value)}
                >
                  <option value="">+ Add role…</option>
                  {available.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </Select>
              </div>
            ) : null
          ) : (
            <p className="text-sm text-slate-400">Only a super admin can change roles.</p>
          )}

          {!isAdmin ? (
            <p className="text-sm text-slate-400">
              Can open:{" "}
              <span className="text-slate-200">
                {areas.length === 0 ? "no admin areas" : areas.map((key) => STAFF_PERMISSIONS[key].label).join(", ")}
              </span>
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
