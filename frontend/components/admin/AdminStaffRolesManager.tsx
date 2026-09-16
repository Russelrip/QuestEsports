"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToastStore } from "@/hooks/useToastStore";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ROLE_COLOR,
  ROLE_COLOR_SWATCHES,
  createStaffRole,
  deleteStaffRole,
  fetchStaffRole,
  fetchStaffRoles,
  isSuperAdmin,
  staffPermissionGroups,
  updateStaffRole,
  type StaffPermission,
  type StaffRole,
  type StaffRoleDetail,
  type StaffRoleInput,
} from "@/lib/staff-permissions";

const NEW_ROLE = "new";

const emptyInput: StaffRoleInput = { name: "", description: "", color: ROLE_COLOR_SWATCHES[0], permissions: [] };

const inputFor = (role: StaffRole): StaffRoleInput => ({
  name: role.name,
  description: role.description ?? "",
  color: role.color ?? DEFAULT_ROLE_COLOR,
  permissions: role.permissions,
});

const sameInput = (left: StaffRoleInput, right: StaffRoleInput) =>
  left.name === right.name
  && left.description === right.description
  && left.color.toLowerCase() === right.color.toLowerCase()
  && left.permissions.length === right.permissions.length
  && left.permissions.every((key) => right.permissions.includes(key));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Staff roles work like Discord roles: a named, coloured set of admin areas.
// Anyone holding the role can open every area it grants. Every admin can look;
// only a super admin can create, edit or delete a role.
export default function AdminStaffRolesManager() {
  const { user } = useAuth();
  const canManage = isSuperAdmin(user);
  const showToast = useToastStore((state) => state.showToast);
  const groups = useMemo(() => staffPermissionGroups(), []);

  const [roles, setRoles] = useState<StaffRole[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffRoleDetail | null>(null);
  const [form, setForm] = useState<StaffRoleInput>(emptyInput);
  const [saving, setSaving] = useState(false);

  const selected = roles?.find((role) => role.id === selectedId) ?? null;
  const baseline = selectedId === NEW_ROLE ? emptyInput : selected ? inputFor(selected) : emptyInput;
  const dirty = selectedId !== null && !sameInput(form, baseline);

  const loadRoles = useCallback(async () => {
    const next = await fetchStaffRoles();
    setRoles(next);
    return next;
  }, []);

  useEffect(() => {
    loadRoles().catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load roles."));
  }, [loadRoles]);

  useEffect(() => {
    setDetail(null);
    if (!selectedId || selectedId === NEW_ROLE) return;
    let cancelled = false;
    fetchStaffRole(selectedId)
      .then((next) => { if (!cancelled) setDetail(next); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selectedId, selected?.memberCount]);

  const select = (roleId: string) => {
    if (roleId === selectedId) return;
    if (dirty && !window.confirm("Discard your unsaved changes to this role?")) return;
    setSelectedId(roleId);
    const role = roles?.find((candidate) => candidate.id === roleId);
    setForm(roleId === NEW_ROLE || !role ? emptyInput : inputFor(role));
  };

  const togglePermission = (key: StaffPermission, checked: boolean) =>
    setForm((current) => ({
      ...current,
      permissions: checked ? [...current.permissions, key] : current.permissions.filter((entry) => entry !== key),
    }));

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage || !selectedId) return;
    setSaving(true);
    try {
      const saved = selectedId === NEW_ROLE
        ? await createStaffRole(form)
        : await updateStaffRole(selectedId, form);
      await loadRoles();
      setSelectedId(saved.id);
      setForm(inputFor(saved));
      showToast({ tone: "success", title: selectedId === NEW_ROLE ? "Role created" : "Role saved", description: `${saved.name} grants ${plural(saved.permissions.length, "area")}.` });
    } catch (error) {
      showToast({ tone: "error", title: "Unable to save role", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!canManage || !selected) return;
    const holders = selected.memberCount > 0 ? ` ${plural(selected.memberCount, "person")} will lose it straight away.` : "";
    if (!window.confirm(`Delete the ${selected.name} role?${holders}`)) return;
    setSaving(true);
    try {
      await deleteStaffRole(selected.id);
      await loadRoles();
      setSelectedId(null);
      setForm(emptyInput);
      showToast({ tone: "success", title: "Role deleted", description: `${selected.name} was removed from everyone who held it.` });
    } catch (error) {
      showToast({ tone: "error", title: "Unable to delete role", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="Roles"
      description="Bundle admin areas into roles, then give roles to people from their user page — the same way roles work on Discord."
    >
      {!canManage ? (
        <Card className="border-amber-300/20 bg-amber-400/5 p-4 text-sm text-amber-100">
          You can see roles, but only a super admin can create, edit or delete them, or give them to people.
        </Card>
      ) : null}

      {loadError ? (
        <EmptyState description={loadError} />
      ) : !roles ? (
        <EmptyState description="Loading roles…" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card className="h-fit p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg text-white">Roles <span className="text-slate-500">— {roles.length}</span></h3>
              {canManage ? (
                <Button type="button" variant="secondary" disabled={saving} onClick={() => select(NEW_ROLE)}>Create role</Button>
              ) : null}
            </div>
            {roles.length === 0 && selectedId !== NEW_ROLE ? (
              <p className="px-1 py-6 text-sm text-slate-400">No roles yet.{canManage ? " Create one to start giving people admin areas." : ""}</p>
            ) : null}
            <ul className="grid gap-1">
              {selectedId === NEW_ROLE ? (
                <li>
                  <span className="flex items-center gap-3 rounded-md bg-white/10 px-3 py-2.5 text-sm text-white">
                    <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: form.color || DEFAULT_ROLE_COLOR }} />
                    <span className="truncate">{form.name || "New role"}</span>
                  </span>
                </li>
              ) : null}
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    aria-current={role.id === selectedId ? "true" : undefined}
                    onClick={() => select(role.id)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
                      role.id === selectedId ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: role.color ?? DEFAULT_ROLE_COLOR }} />
                    <span className="min-w-0 flex-1 truncate">{role.name}</span>
                    <span className="shrink-0 text-xs text-slate-500" title={`${plural(role.memberCount, "member")}, ${plural(role.permissions.length, "area")}`}>
                      {role.memberCount} · {role.permissions.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {roles.length > 0 ? <p className="mt-3 px-1 text-xs text-slate-500">Members · areas</p> : null}
          </Card>

          {selectedId === null ? (
            <Card className="p-6 sm:p-8">
              <EmptyState description={roles.length > 0 ? "Pick a role to see what it can open." : "Roles you create will show up here."} />
            </Card>
          ) : (
            <form className="grid gap-6" onSubmit={save}>
              <Card className="p-6 sm:p-8">
                <h3 className="mb-6 text-2xl text-white">{selectedId === NEW_ROLE ? "Create role" : `Edit role — ${selected?.name ?? ""}`}</h3>
                <fieldset disabled={!canManage || saving} className="grid gap-5 md:grid-cols-2">
                  <FormField label="Role name" htmlFor="role-name" required>
                    <Input
                      id="role-name"
                      maxLength={40}
                      required
                      placeholder="Media Team"
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Colour" htmlFor="role-color">
                    <div className="flex flex-wrap items-center gap-2">
                      {ROLE_COLOR_SWATCHES.map((swatch) => (
                        <button
                          key={swatch}
                          type="button"
                          aria-label={`Use colour ${swatch}`}
                          aria-pressed={form.color.toLowerCase() === swatch}
                          onClick={() => setForm((current) => ({ ...current, color: swatch }))}
                          className={cn(
                            "h-7 w-7 rounded-full border-2 transition disabled:cursor-not-allowed",
                            form.color.toLowerCase() === swatch ? "border-white" : "border-transparent hover:border-white/50"
                          )}
                          style={{ backgroundColor: swatch }}
                        />
                      ))}
                      <Input
                        id="role-color"
                        aria-label="Hex colour"
                        className="w-28"
                        maxLength={7}
                        value={form.color}
                        onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                      />
                    </div>
                  </FormField>
                  <FormField label="Description" htmlFor="role-description" className="md:col-span-2">
                    <Textarea
                      id="role-description"
                      rows={2}
                      maxLength={200}
                      placeholder="What this role is for"
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    />
                  </FormField>
                </fieldset>
              </Card>

              <Card className="p-6 sm:p-8">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-2xl text-white">Admin areas</h3>
                    <p className="text-sm text-slate-400">People with this role can open every area switched on here.</p>
                  </div>
                  {canManage && form.permissions.length > 0 ? (
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => setForm((current) => ({ ...current, permissions: [] }))}>
                      Clear areas
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-6">
                  {groups.map((group) => (
                    <fieldset key={group.label} disabled={!canManage || saving} className="grid gap-2">
                      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{group.label}</legend>
                      {group.areas.map((area) => {
                        const checked = form.permissions.includes(area.key);
                        return (
                          <label
                            key={area.key}
                            className="flex min-w-0 cursor-pointer items-start justify-between gap-4 border-b border-white/6 py-3 last:border-b-0"
                          >
                            <span className="min-w-0">
                              <span className="block font-semibold text-white">{area.label}</span>
                              <span className="block text-sm text-slate-400">{area.description}</span>
                            </span>
                            <input
                              type="checkbox"
                              role="switch"
                              aria-checked={checked}
                              className="peer sr-only"
                              checked={checked}
                              onChange={(event) => togglePermission(area.key, event.target.checked)}
                            />
                            <span
                              aria-hidden
                              className={cn(
                                "relative mt-1 h-6 w-11 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-violet-300 peer-disabled:opacity-50",
                                checked ? "bg-emerald-500" : "bg-slate-600"
                              )}
                            >
                              <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition", checked ? "left-6" : "left-1")} />
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
              </Card>

              {selectedId !== NEW_ROLE ? (
                <Card className="p-6 sm:p-8">
                  <h3 className="text-2xl text-white">Members <span className="text-slate-500">— {selected?.memberCount ?? 0}</span></h3>
                  <p className="mb-4 text-sm text-slate-400">Give someone this role from their page under Users.</p>
                  {!detail ? (
                    <p className="text-sm text-slate-400">Loading members…</p>
                  ) : detail.members.length === 0 ? (
                    <p className="text-sm text-slate-400">Nobody has this role yet.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {detail.members.map((member) => (
                        <li key={member.id} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-200">
                          {member.firstName} {member.lastName} <span className="text-slate-500">@{member.username}</span>
                          {member.role === "admin" ? <span className="ml-1 text-xs text-slate-500">(admin)</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ) : null}

              {canManage ? (
                <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#15131f]/95 p-4 shadow-xl backdrop-blur">
                  <p className="mr-auto text-sm text-slate-300">{dirty ? "You have unsaved changes." : selectedId === NEW_ROLE ? "Name the role and switch on its areas." : "No unsaved changes."}</p>
                  {selectedId !== NEW_ROLE ? (
                    <Button type="button" variant="danger" disabled={saving} onClick={() => void remove()}>Delete role</Button>
                  ) : null}
                  {dirty ? (
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => setForm(baseline)}>Reset</Button>
                  ) : null}
                  <Button type="submit" disabled={saving || !dirty || !form.name.trim()}>
                    {saving ? "Saving..." : selectedId === NEW_ROLE ? "Create role" : "Save changes"}
                  </Button>
                </div>
              ) : null}
            </form>
          )}
        </div>
      )}
    </AdminShell>
  );
}
