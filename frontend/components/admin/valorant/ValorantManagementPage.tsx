"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import ValorantDiscoveryManager from "@/components/admin/valorant/ValorantDiscoveryManager";
import ValorantRankingsManager from "@/components/admin/valorant/ValorantRankingsManager";
import ValorantReconciliationManager from "@/components/admin/valorant/ValorantReconciliationManager";
import ValorantSeriesDetail from "@/components/admin/valorant/ValorantSeriesDetail";
import ValorantSeriesForm from "@/components/admin/valorant/ValorantSeriesForm";
import ValorantSeriesManager from "@/components/admin/valorant/ValorantSeriesManager";
import ValorantTeamsManager from "@/components/admin/valorant/ValorantTeamsManager";
import { cn } from "@/lib/utils";

type Tab = "teams" | "discover" | "series" | "rankings" | "reconciliation";

type SeriesSubView =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; seriesId: string };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "teams", label: "Team Bindings" },
  { id: "discover", label: "Discovery" },
  { id: "series", label: "Series" },
  { id: "rankings", label: "Rankings" },
  { id: "reconciliation", label: "Reconciliation" },
];

export default function ValorantManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>("series");
  const [seriesSubView, setSeriesSubView] = useState<SeriesSubView>({ kind: "list" });

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
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
      case "discover":
        return <ValorantDiscoveryManager />;
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
        {tabs.map((tab) => {
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
