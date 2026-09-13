"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { useAuth } from "@/components/auth/AuthProvider";
import ValorantLeaderboardPlayersManager from "@/components/admin/valorant/ValorantLeaderboardPlayersManager";
import ValorantRankingsManager from "@/components/admin/valorant/ValorantRankingsManager";
import ValorantReconciliationManager from "@/components/admin/valorant/ValorantReconciliationManager";
import ValorantSeriesDetail from "@/components/admin/valorant/ValorantSeriesDetail";
import ValorantSeriesForm from "@/components/admin/valorant/ValorantSeriesForm";
import ValorantSeriesManager from "@/components/admin/valorant/ValorantSeriesManager";
import ValorantTeamsManager from "@/components/admin/valorant/ValorantTeamsManager";
import { hasStaffPermission, type StaffPermission } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";

type Tab = "teams" | "series" | "rankings" | "leaderboard" | "reconciliation";

type SeriesSubView =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; seriesId: string };

// A tab with a permission is also open to staff granted that area; the rest are
// admin-only. The backend enforces the same split on every route.
const tabs: Array<{ id: Tab; label: string; permission?: StaffPermission }> = [
  { id: "teams", label: "Team Bindings" },
  { id: "series", label: "Series" },
  { id: "rankings", label: "Rankings" },
  { id: "leaderboard", label: "Leaderboard Players", permission: "valorant_leaderboard" },
  { id: "reconciliation", label: "Reconciliation" },
];

export default function ValorantManagementPage() {
  const { user } = useAuth();
  const visibleTabs = tabs.filter((tab) =>
    user?.role === "admin" || (tab.permission ? hasStaffPermission(user, tab.permission) : false)
  );
  const [selectedTab, setSelectedTab] = useState<Tab>("series");
  const activeTab = visibleTabs.some((tab) => tab.id === selectedTab)
    ? selectedTab
    : (visibleTabs[0]?.id ?? selectedTab);
  const [seriesSubView, setSeriesSubView] = useState<SeriesSubView>({ kind: "list" });

  const handleTabChange = (tab: Tab) => {
    setSelectedTab(tab);
    if (tab === "series") {
      setSeriesSubView({ kind: "list" });
    }
  };

  const handleViewSeries = (seriesId: string) => {
    setSeriesSubView({ kind: "detail", seriesId });
  };

  const handleCreateSeries = () => {
    setSeriesSubView({ kind: "new" });
  };

  const handleSeriesCreated = (seriesId: string) => {
    setSeriesSubView({ kind: "detail", seriesId });
  };

  const handleBackToSeriesList = () => {
    setSeriesSubView({ kind: "list" });
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "teams":
        return <ValorantTeamsManager />;
      case "series":
        switch (seriesSubView.kind) {
          case "list":
            return (
              <ValorantSeriesManager
                onViewSeries={handleViewSeries}
                onCreateSeries={handleCreateSeries}
              />
            );
          case "new":
            return (
              <ValorantSeriesForm
                onCreated={handleSeriesCreated}
                onCancel={handleBackToSeriesList}
              />
            );
          case "detail":
            return (
              <ValorantSeriesDetail
                seriesId={seriesSubView.seriesId}
                onBack={handleBackToSeriesList}
              />
            );
        }
      case "rankings":
        return <ValorantRankingsManager />;
      case "leaderboard":
        return <ValorantLeaderboardPlayersManager />;
      case "reconciliation":
        return <ValorantReconciliationManager />;
    }
  };

  return (
    <AdminShell
      title="Valorant Management"
      description="Run standalone VALORANT competitive series with Riot-sourced results and ELO ratings."
    >
      <div
        role="tablist"
        aria-label="Valorant Management sections"
        className="flex flex-wrap gap-2 border-b border-white/10 pb-3"
      >
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "border-b-2 border-purple-300 text-white"
                  : "text-slate-400 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="grid min-w-0 gap-4 sm:gap-6">
        {renderTabContent()}
      </div>
    </AdminShell>
  );
}
