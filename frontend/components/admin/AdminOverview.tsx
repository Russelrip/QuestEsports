"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { AdminDashboardStats, adminRequest } from "@/lib/admin";

const emptyStats: AdminDashboardStats = {
  totalTournaments: 0,
  openTournaments: 0,
  totalRegistrations: 0,
  unreadContactMessages: 0,
};

const statCards = (stats: AdminDashboardStats) => [
  {
    label: "Total Tournaments",
    value: stats.totalTournaments,
    href: "/admin/tournaments",
    action: "Manage events",
  },
  {
    label: "Open Tournaments",
    value: stats.openTournaments,
    href: "/admin/tournaments",
    action: "Review status",
  },
  {
    label: "Total Registrations",
    value: stats.totalRegistrations,
    href: "/admin/registrations",
    action: "Review queue",
  },
  {
    label: "Unread Contact Messages",
    value: stats.unreadContactMessages,
    href: "/admin/contact-messages",
    action: "Open inbox",
  },
];

export default function AdminOverview() {
  const [stats, setStats] = useState<AdminDashboardStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminRequest<{ stats: AdminDashboardStats }>("/api/admin/dashboard");
        setStats(data.stats);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to load dashboard stats.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <AdminShell
      title="Control Center"
      description="Track tournament health, registration load, and incoming community messages from one place."
      actions={
        <Link href="/admin/tournaments/new" className={buttonClassName({})}>
          New Tournament
        </Link>
      }
    >
      {loading ? (
        <LoadingState title="Loading dashboard" description="Fetching the latest platform stats." />
      ) : error ? (
        <EmptyState description={error} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
          {statCards(stats).map((card) => (
            <Card key={card.label} className="p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{card.label}</p>
              <p className="mt-5 text-4xl font-semibold text-white">{card.value}</p>
              <div className="mt-6">
                <Link href={card.href} className={buttonClassName({ variant: "secondary", className: "w-full" })}>
                  {card.action}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
