"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminUsers } from "@/hooks/api/useAdmin";
import { useToastStore } from "@/hooks/useToastStore";
import {
  type AdminUser,
  type UserFormValues,
  adminRequest,
  getAdminPaginationSummary,
  initialUserFormValues,
} from "@/lib/admin";

export default function AdminUsersManager() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<UserFormValues>(initialUserFormValues);
  const { data, error, loading, refetch } = useAdminUsers(search, roleFilter, page);
  const showToast = useToastStore((state) => state.showToast);

  const users = data?.users || [];
  const pagination = data?.pagination;

  useEffect(() => {
    setPage(1);
  }, [roleFilter, search]);

  const updateField = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) => {
    setFormValues((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setEditingUserId(null);
    setFormValues(initialUserFormValues);
  };

  const startEdit = (user: AdminUser) => {
    setEditingUserId(user.id);
    setFormValues({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      username: user.username,
      phone: user.phone || "",
      discordTag: user.discordTag || "",
      role: user.role,
      password: "",
      confirmPassword: "",
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    try {
      const payload = {
        ...formValues,
        ...(editingUserId ? {} : { password: formValues.password, confirmPassword: formValues.confirmPassword }),
      };

      const data = await adminRequest<{ user: AdminUser }>(
        editingUserId ? `/api/admin/users/${editingUserId}` : "/api/admin/users",
        { method: editingUserId ? "PATCH" : "POST", json: payload }
      );

      showToast({
        tone: "success",
        title: editingUserId ? "User updated" : "User created",
        description: data.message || "User saved successfully.",
      });
      resetForm();
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to save user",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm("Delete this user account?")) {
      return;
    }

    try {
      await adminRequest(`/api/admin/users/${userId}`, { method: "DELETE" });
      showToast({ tone: "success", title: "User deleted" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to delete user",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  return (
    <AdminShell
      title="Users"
      description="Create users, update account details, and manage admin access from one control surface."
    >
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-2">
          <h3 className="text-2xl text-white">{editingUserId ? "Edit User" : "Create User"}</h3>
          <p className="text-sm text-slate-400">
            {editingUserId ? "Update user details or change their role." : "Add a new user directly from the dashboard."}
          </p>
        </div>

        <form className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" onSubmit={handleSubmit}>
          <FormField label="First Name" htmlFor="firstName" required>
            <Input id="firstName" value={formValues.firstName} onChange={(event) => updateField("firstName", event.target.value)} required />
          </FormField>
          <FormField label="Last Name" htmlFor="lastName" required>
            <Input id="lastName" value={formValues.lastName} onChange={(event) => updateField("lastName", event.target.value)} required />
          </FormField>
          <FormField label="Email" htmlFor="email" required>
            <Input id="email" type="email" value={formValues.email} onChange={(event) => updateField("email", event.target.value)} required />
          </FormField>
          <FormField label="Username" htmlFor="username" required>
            <Input id="username" value={formValues.username} onChange={(event) => updateField("username", event.target.value)} required />
          </FormField>
          <FormField label="Phone" htmlFor="phone">
            <Input id="phone" value={formValues.phone} onChange={(event) => updateField("phone", event.target.value)} />
          </FormField>
          <FormField label="Discord Tag" htmlFor="discordTag">
            <Input id="discordTag" value={formValues.discordTag} onChange={(event) => updateField("discordTag", event.target.value)} />
          </FormField>
          <FormField label="Role" htmlFor="role" required>
            <Select id="role" value={formValues.role} onChange={(event) => updateField("role", event.target.value as UserFormValues["role"])}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </FormField>
          <FormField label={editingUserId ? "New Password" : "Password"} htmlFor="password">
            <Input id="password" type="password" value={formValues.password} onChange={(event) => updateField("password", event.target.value)} required={!editingUserId} />
          </FormField>
          <FormField label={editingUserId ? "Confirm New Password" : "Confirm Password"} htmlFor="confirmPassword">
            <Input id="confirmPassword" type="password" value={formValues.confirmPassword} onChange={(event) => updateField("confirmPassword", event.target.value)} required={!editingUserId} />
          </FormField>
          <div className="md:col-span-2 xl:col-span-3 flex flex-wrap gap-3">
            <Button type="submit" disabled={saving}>{saving ? "Saving..." : editingUserId ? "Save User" : "Create User"}</Button>
            {(editingUserId || Object.values(formValues).some(Boolean)) ? (
              <Button type="button" variant="secondary" onClick={resetForm}>Cancel</Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="text-2xl text-white">User Accounts</h3>
            <p className="text-sm text-slate-400">Search accounts and manage admin access from one table.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or username..." />
            <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">All roles</option>
              <option value="user">Users</option>
              <option value="admin">Admins</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <AdminTableSkeleton />
        ) : error ? (
          <EmptyState description={error} />
        ) : users.length === 0 ? (
          <EmptyState description="No users matched your search or filters." />
        ) : (
          <div className="grid gap-4">
            {users.map((user) => (
              <div key={user.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/5 p-5 xl:grid-cols-[1.2fr_1fr_0.9fr_auto] xl:items-center">
                <div>
                  <p className="font-semibold text-white">{user.firstName} {user.lastName}</p>
                  <p className="text-sm text-slate-400">@{user.username}</p>
                  <p className="text-sm text-slate-500">{user.email}</p>
                </div>
                <div className="grid gap-1 text-sm text-slate-400">
                  <p>Role: <span className="text-white">{user.role}</span></p>
                  <p>Created: {user.createdAt ? new Date(user.createdAt).toLocaleString() : "N/A"}</p>
                  <p>Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "N/A"}</p>
                </div>
                <div className="grid gap-1 text-sm text-slate-400">
                  <p>Phone: {user.phone || "N/A"}</p>
                  <p>Discord: {user.discordTag || "N/A"}</p>
                </div>
                <div className="flex flex-wrap gap-3 xl:justify-end">
                  <Button type="button" variant="secondary" onClick={() => startEdit(user)}>Edit</Button>
                  <Button type="button" variant="danger" onClick={() => handleDelete(user.id)}>Delete</Button>
                </div>
              </div>
            ))}
            {pagination ? (
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination)}</p>
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
