"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { AdminDashboardStats, adminRequest } from "@/lib/admin";

const emptyStats: AdminDashboardStats = {
  totalTournaments: 0,
  openTournaments: 0,
  totalRegistrations: 0,
  pendingRecruitmentApplications: 0,
  unreadContactMessages: 0,
};

const dashboardGroups = (stats: AdminDashboardStats) => [
  {
    label: "Competition",
    description: "Tournament publishing and entry activity.",
    stats: [
      { label: "All tournaments", value: stats.totalTournaments, href: "/admin/tournaments" },
      { label: "Registration open", value: stats.openTournaments, href: "/admin/tournaments" },
      { label: "Registrations", value: stats.totalRegistrations, href: "/admin/registrations" },
    ],
  },
  {
    label: "People & Support",
    description: "Items that may need an admin response.",
    stats: [
      { label: "Recruitment pending", value: stats.pendingRecruitmentApplications, href: "/admin/recruitment" },
      { label: "Unread messages", value: stats.unreadContactMessages, href: "/admin/contact-messages" },
    ],
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
        <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
          {dashboardGroups(stats).map((group) => (
            <Card key={group.label} className="overflow-hidden">
              <div className="border-b border-white/10 px-6 py-5">
                <h3 className="text-xl text-white">{group.label}</h3>
                <p className="mt-1 text-sm text-slate-400">{group.description}</p>
              </div>
              <div className="divide-y divide-white/10">
                {group.stats.map((stat) => (
                  <Link key={stat.label} href={stat.href} className="flex items-center justify-between gap-5 px-6 py-5 transition hover:bg-white/[0.04]">
                    <span className="text-sm font-medium text-slate-300">{stat.label}</span>
                    <span className="text-3xl font-semibold text-white">{stat.value}</span>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
