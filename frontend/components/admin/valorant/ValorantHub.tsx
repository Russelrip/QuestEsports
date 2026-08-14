"use client";

import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  useValorantBindings,
  useValorantReconciliation,
  useValorantSeriesList,
} from "@/hooks/api/useValorant";

function HubCard({
  href,
  title,
  description,
  badge,
  subtitle,
}: {
  href: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <Card className="transition hover:border-white/20 hover:bg-white/[0.03]">
      <Link href={href} className="block min-w-0 p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-xl text-white">{title}</h3>
          {badge}
        </div>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </Link>
    </Card>
  );
}

function HubSlot({ children }: { children: React.ReactNode }) {
  return <Card className="p-6">{children}</Card>;
}

export default function ValorantHub() {
  const bindingsQuery = useValorantBindings();
  const seriesQuery = useValorantSeriesList();
  const reconciliationQuery = useValorantReconciliation();

  const activeBindings =
    bindingsQuery.data?.bindings.filter((binding) => binding.status === "active").length ?? 0;
  const series = seriesQuery.data?.series ?? [];
  const draftCount = series.filter((entry) => entry.status === "draft").length;
  const stuckOperations =
    reconciliationQuery.data?.report.stuckOperations.length ?? 0;

  return (
    <AdminShell
      title="VALORANT"
      description="Run standalone VALORANT competitive series with Riot-sourced results and ELO ratings."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bindingsQuery.error ? (
          <HubSlot>
            <ValorantErrorAlert message={bindingsQuery.error} onRetry={() => void bindingsQuery.refetch()} />
          </HubSlot>
        ) : bindingsQuery.loading ? (
          <HubSlot>
            <ValorantLoadingState />
          </HubSlot>
        ) : (
          <HubCard
            href="/admin/valorant/teams"
            title="Team Bindings"
            description="Link Quest SavedTeams to their VALORANT teams."
            badge={
              <Badge className="border-purple-300/20 bg-purple-400/10 text-purple-100">
                {activeBindings}
              </Badge>
            }
          />
        )}

        <HubCard
          href="/admin/valorant/discover"
          title="Match Discovery"
          description="Search and import matches between two Riot IDs."
        />

        {seriesQuery.error ? (
          <HubSlot>
            <ValorantErrorAlert message={seriesQuery.error} onRetry={() => void seriesQuery.refetch()} />
          </HubSlot>
        ) : seriesQuery.loading ? (
          <HubSlot>
            <ValorantLoadingState />
          </HubSlot>
        ) : (
          <HubCard
            href="/admin/valorant/series"
            title="Series"
            description="Create and run BO1/BO3/BO5 competitive series."
            badge={<Badge>{series.length}</Badge>}
            subtitle={`${draftCount} draft${draftCount === 1 ? "" : "s"}`}
          />
        )}

        <HubCard
          href="/admin/valorant/rankings"
          title="Rankings"
          description="Current ELO standings and rating history."
        />

        {reconciliationQuery.error ? (
          <HubSlot>
            <ValorantErrorAlert message={reconciliationQuery.error} onRetry={() => void reconciliationQuery.refetch()} />
          </HubSlot>
        ) : reconciliationQuery.loading ? (
          <HubSlot>
            <ValorantLoadingState />
          </HubSlot>
        ) : (
          <HubCard
            href="/admin/valorant/reconciliation"
            title="Reconciliation"
            description="Review operations stuck between Quest and the platform."
            badge={
              stuckOperations > 0 ? (
                <Badge className="border-amber-300/20 bg-amber-400/10 text-amber-100">
                  {stuckOperations}
                </Badge>
              ) : undefined
            }
          />
        )}
      </div>
    </AdminShell>
  );
}
