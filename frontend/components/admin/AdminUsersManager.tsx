"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import {
  AdminUser,
  Pagination,
  UserFormValues,
  adminRequest,
  emptyPagination,
  initialUserFormValues,
} from "@/lib/admin";

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "N/A";

export default function AdminUsersManager() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<Pagination>(emptyPagination);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<UserFormValues>(initialUserFormValues);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "10",
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (roleFilter) {
        params.set("role", roleFilter);
      }

      const data = await adminRequest<{
        users: AdminUser[];
        pagination: Pagination;
      }>(`/api/admin/users?${params.toString()}`);

      setUsers(data.users);
      setPagination(data.pagination);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, search]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const updateField = <K extends keyof UserFormValues>(
    key: K,
    value: UserFormValues[K]
  ) => {
    setFormValues((current) => ({ ...current, [key]: value }));
  };

  const resetForm = ({ keepMessages = false } = {}) => {
    setEditingUserId(null);
    setFormValues(initialUserFormValues);
    if (!keepMessages) {
      setSuccessMessage("");
      setError("");
    }
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
    setSuccessMessage("");
    setError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const payload = {
        ...formValues,
        ...(editingUserId
          ? {}
          : {
              password: formValues.password,
              confirmPassword: formValues.confirmPassword,
            }),
      };

      const data = await adminRequest<{ user: AdminUser }>(
        editingUserId ? `/api/admin/users/${editingUserId}` : "/api/admin/users",
        {
          method: editingUserId ? "PATCH" : "POST",
          json: payload,
        }
      );

      setSuccessMessage(data.message || "User saved successfully.");
      resetForm({ keepMessages: true });
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save user.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm("Delete this user account?")) {
      return;
    }

    try {
      await adminRequest(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      setSuccessMessage("User deleted successfully.");
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete user.");
    }
  };

  return (
    <AdminShell
      title="Users"
      description="Create users, update their account details, and promote or demote admin access."
    >
      <div className="admin-users-card">
        <div className="admin-users-head">
          <div>
            <h3>{editingUserId ? "Edit User" : "Create User"}</h3>
            <p>
              {editingUserId
                ? "Update user details or change their role."
                : "Add a new user directly from the dashboard."}
            </p>
          </div>
        </div>

        <form className="admin-form-grid" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="firstName">First Name *</label>
            <input
              id="firstName"
              value={formValues.firstName}
              onChange={(event) => updateField("firstName", event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="lastName">Last Name *</label>
            <input
              id="lastName"
              value={formValues.lastName}
              onChange={(event) => updateField("lastName", event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email *</label>
            <input
              id="email"
              type="email"
              value={formValues.email}
              onChange={(event) => updateField("email", event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="username">Username *</label>
            <input
              id="username"
              value={formValues.username}
              onChange={(event) => updateField("username", event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              value={formValues.phone}
              onChange={(event) => updateField("phone", event.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="discordTag">Discord Tag</label>
            <input
              id="discordTag"
              value={formValues.discordTag}
              onChange={(event) => updateField("discordTag", event.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="role">Role *</label>
            <select
              id="role"
              value={formValues.role}
              onChange={(event) =>
                updateField("role", event.target.value as UserFormValues["role"])
              }
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="password">
              {editingUserId ? "New Password" : "Password *"}
            </label>
            <input
              id="password"
              type="password"
              value={formValues.password}
              onChange={(event) => updateField("password", event.target.value)}
              required={!editingUserId}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">
              {editingUserId ? "Confirm New Password" : "Confirm Password *"}
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={formValues.confirmPassword}
              onChange={(event) => updateField("confirmPassword", event.target.value)}
              required={!editingUserId}
            />
          </div>

          {error ? <p className="error-message admin-form-full">{error}</p> : null}
          {successMessage ? (
            <p className="success-inline admin-form-full">{successMessage}</p>
          ) : null}

          <div className="admin-table-actions admin-form-full">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? "Saving..."
                : editingUserId
                  ? "Save User"
                  : "Create User"}
            </button>
            {(editingUserId || Object.values(formValues).some(Boolean)) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => resetForm()}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="admin-users-card">
        <div className="admin-users-head">
          <div>
            <h3>User Accounts</h3>
            <p>Search accounts and manage admin access from one table.</p>
          </div>
          <div className="admin-filter-row">
            <input
              type="search"
              className="admin-search-input"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search name, email, or username..."
            />
            <select
              value={roleFilter}
              onChange={(event) => {
                setPage(1);
                setRoleFilter(event.target.value);
              }}
            >
              <option value="">All roles</option>
              <option value="user">Users</option>
              <option value="admin">Admins</option>
            </select>
          </div>
        </div>

        {loading ? (
          <EmptyState description="Loading users..." />
        ) : users.length === 0 ? (
          <EmptyState description="No users matched your search or filters." />
        ) : (
          <>
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        {user.firstName} {user.lastName}
                      </td>
                      <td>{user.username}</td>
                      <td>{user.email}</td>
                      <td>
                        <span className={`table-role ${user.role === "admin" ? "is-approved" : ""}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>{formatDate(user.lastLoginAt)}</td>
                      <td>
                        <div className="admin-table-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => startEdit(user)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small admin-danger-button"
                            onClick={() => handleDelete(user.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-pagination">
              <p>
                Page {pagination.page} of {pagination.totalPages} - {pagination.total} total
              </p>
              <div className="admin-pagination-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
