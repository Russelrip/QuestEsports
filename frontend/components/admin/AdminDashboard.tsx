"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";

type DashboardStats = {
  totalUsers: number;
  totalAdmins: number;
  totalContacts: number;
  totalTeamRegistrations: number;
};

type DashboardUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  role: string;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

const emptyStats: DashboardStats = {
  totalUsers: 0,
  totalAdmins: 0,
  totalContacts: 0,
  totalTeamRegistrations: 0,
};

export default function AdminDashboard() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }

    if (!user) {
      return;
    }

    if (user.role !== "admin") {
      setLoading(false);
      setError("This area is only available for admins.");
      return;
    }

    const loadDashboard = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await apiFetch("/api/admin/dashboard");
        const data = await response.json();

        if (!response.ok || !data.success) {
          setError(data.message || "Unable to load the admin dashboard.");
          return;
        }

        setStats(data.stats);
        setUsers(data.users);
      } catch (requestError) {
        console.error("Admin dashboard request failed:", requestError);
        setError("Something went wrong while loading admin data.");
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [isLoading, router, user]);

  if (isLoading) {
    return null;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="admin-section">
      <div className="container admin-dashboard">
        <div className="admin-header">
          <div>
            <span className="profile-badge">Admin Dashboard</span>
            <h2>Manage Quest Esports accounts</h2>
            <p className="section-intro">
              Signed in as <strong>{user.username}</strong>. This dashboard gives
              you a quick view of users, contacts, and registrations.
            </p>
          </div>
          <Link href="/profile" className="btn btn-secondary btn-small">
            View My Profile
          </Link>
        </div>

        {loading ? (
          <div className="empty-state">
            <p>Loading dashboard data...</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="admin-stats-grid">
              <article className="admin-stat-card">
                <span>Total Users</span>
                <strong>{stats.totalUsers}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Admins</span>
                <strong>{stats.totalAdmins}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Contact Messages</span>
                <strong>{stats.totalContacts}</strong>
              </article>
              <article className="admin-stat-card">
                <span>Team Registrations</span>
                <strong>{stats.totalTeamRegistrations}</strong>
              </article>
            </div>

            <div className="admin-users-card">
              <div className="admin-users-head">
                <h3>Registered Users</h3>
                <p>{users.length} account(s)</p>
              </div>

              <div className="admin-users-table-wrap">
                <table className="admin-users-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Last Login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((registeredUser) => (
                      <tr key={registeredUser.id}>
                        <td>
                          {registeredUser.firstName} {registeredUser.lastName}
                        </td>
                        <td>{registeredUser.username}</td>
                        <td>{registeredUser.email}</td>
                        <td>
                          <span className="table-role">{registeredUser.role}</span>
                        </td>
                        <td>
                          {registeredUser.lastLoginAt
                            ? new Date(registeredUser.lastLoginAt).toLocaleString()
                            : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
