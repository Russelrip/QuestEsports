"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { AdminDashboardStats, adminRequest } from "@/lib/admin";

const emptyStats: AdminDashboardStats = {
  totalTournaments: 0,
  openTournaments: 0,
  totalRegistrations: 0,
  unreadContactMessages: 0,
};

export default function AdminOverview() {
  const [stats, setStats] = useState<AdminDashboardStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminRequest<{ stats: AdminDashboardStats }>(
          "/api/admin/dashboard"
        );
        setStats(data.stats);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load dashboard stats."
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <AdminShell
      title="Control Center"
      description="Track tournaments, registrations, and contact messages from a single place."
      actions={
        <Link href="/admin/tournaments/new" className="btn btn-primary btn-small">
          New Tournament
        </Link>
      }
    >
      {loading ? (
        <EmptyState description="Loading dashboard stats..." />
      ) : error ? (
        <EmptyState description={error} />
      ) : (
        <div className="admin-stats-grid">
          <article className="admin-stat-card">
            <span>Total Tournaments</span>
            <strong>{stats.totalTournaments}</strong>
            <div className="admin-stat-actions">
              <Link href="/admin/tournaments" className="btn btn-secondary btn-small">
                View All
              </Link>
              <Link href="/admin/tournaments/new" className="btn btn-secondary btn-small">
                Create
              </Link>
            </div>
          </article>
          <article className="admin-stat-card">
            <span>Open Tournaments</span>
            <strong>{stats.openTournaments}</strong>
            <div className="admin-stat-actions">
              <Link href="/admin/tournaments" className="btn btn-secondary btn-small">
                Manage
              </Link>
            </div>
          </article>
          <article className="admin-stat-card">
            <span>Total Registrations</span>
            <strong>{stats.totalRegistrations}</strong>
            <div className="admin-stat-actions">
              <Link href="/admin/registrations" className="btn btn-secondary btn-small">
                Review
              </Link>
            </div>
          </article>
          <article className="admin-stat-card">
            <span>Unread Contact Messages</span>
            <strong>{stats.unreadContactMessages}</strong>
            <div className="admin-stat-actions">
              <Link
                href="/admin/contact-messages"
                className="btn btn-secondary btn-small"
              >
                Open Inbox
              </Link>
            </div>
          </article>
        </div>
      )}
    </AdminShell>
  );
}
