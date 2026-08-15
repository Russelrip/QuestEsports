"use client";

import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantStatusBadge from "@/components/admin/valorant/ValorantStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantReconciliation } from "@/hooks/api/useValorant";

function ReportSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</h3>
        <span role="status">
          <Badge className="border-white/10 bg-white/6 text-slate-200">{count}</Badge>
        </span>
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

export default function ValorantReconciliationManager() {
  const reportQuery = useValorantReconciliation();
  const report = reportQuery.data?.report;

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Reconciliation</h3>
          <p className="text-sm text-slate-400">
            Detect mismatches between Quest projections and the VALORANT platform. All checks are read-only.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void reportQuery.refetch()}
          disabled={reportQuery.loading}
        >
          Refresh report
        </Button>
      </div>

      {reportQuery.error ? (
        <ValorantErrorAlert message={reportQuery.error} onRetry={() => void reportQuery.refetch()} />
      ) : reportQuery.loading || !report ? (
        <ValorantLoadingState />
      ) : report.orphaned.length +
          report.unprojected.length +
          report.teamMissing.length +
          report.matchMissing.length +
          report.stuckOperations.length ===
        0 ? (
        <ValorantEmptyState
          title="No mismatches detected"
          description="Quest and the VALORANT platform are in sync."
        />
      ) : (
        <div className="grid min-w-0 gap-4 sm:gap-6 md:grid-cols-2">
          <ReportSection title="Orphaned series" count={report.orphaned.length}>
            {report.orphaned.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No orphaned series.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {report.orphaned.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-400">{entry.id}</span>
                    <span className="text-slate-200">{entry.externalKey}</span>
                    <span className="font-mono text-xs text-slate-500">{entry.valorantSeriesUuid ?? "—"}</span>
                    <ValorantStatusBadge status={entry.status} kind="series" />
                  </li>
                ))}
              </ul>
            )}
          </ReportSection>

          <ReportSection title="Series without a Quest projection" count={report.unprojected.length}>
            {report.unprojected.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No unprojected series.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {report.unprojected.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-400">{entry.id}</span>
                    <span className="font-mono text-xs text-slate-500">{entry.externalQuestSeriesId ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </ReportSection>

          <ReportSection title="Bindings with a missing VALORANT team" count={report.teamMissing.length}>
            {report.teamMissing.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">All bound teams resolve.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {report.teamMissing.map((binding) => (
                  <li key={binding.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="text-slate-200">{binding.savedTeam?.name ?? "Detached team"}</span>
                    <span className="font-mono text-xs text-slate-500">{binding.valorantTeamUuid}</span>
                  </li>
                ))}
              </ul>
            )}
          </ReportSection>

          <ReportSection title="Match projections with a missing match" count={report.matchMissing.length}>
            {report.matchMissing.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">All match projections resolve.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {report.matchMissing.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-400">{entry.henrikMatchId}</span>
                    <span className="font-mono text-xs text-slate-500">{entry.matchId}</span>
                  </li>
                ))}
              </ul>
            )}
          </ReportSection>

          <ReportSection title="Stuck operations" count={report.stuckOperations.length}>
            {report.stuckOperations.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No stuck operations.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {report.stuckOperations.map((operation) => (
                  <li key={operation.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                    <span className="font-mono text-xs text-slate-400">{operation.operationId}</span>
                    <span className="text-slate-200">{operation.type}</span>
                    <ValorantStatusBadge status={operation.status} kind="operation" />
                    <span className="font-mono text-xs text-slate-500">{operation.questSeriesId ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-white/5 pt-3 text-xs text-slate-500">
              Open the related series and use &apos;Re-check status&apos; — the UI never retries automatically.
            </p>
          </ReportSection>

          <p className="text-xs text-slate-500">
            Projection re-sync and adoption are backend operations (FastAPI reads only) — MVP offers no destructive cleanup.
          </p>
        </div>
      )}
    </div>
  );
}
