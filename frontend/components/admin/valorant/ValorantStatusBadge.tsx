"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  operationStatusLabel,
  seriesStatusLabel,
  type ValorantBindingStatus,
  type ValorantOperationStatus,
  type ValorantSeriesStatus,
} from "@/lib/valorant";

const toneFor = (status: ValorantSeriesStatus | ValorantBindingStatus | ValorantOperationStatus): string => {
  switch (status) {
    case "draft":
    case "active":
      return "border-purple-300/20 bg-purple-400/10 text-purple-100";
    case "finalized":
    case "succeeded":
      return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
    case "failed":
      return "border-red-400/25 bg-red-500/12 text-red-100";
    case "reconciliation_required":
      return "border-amber-300/20 bg-amber-400/10 text-amber-100";
    case "orphaned":
    case "detached":
    case "pending":
      return "border-white/10 bg-white/6 text-slate-300";
    case "in_flight":
      return "animate-pulse border-white/10 bg-white/6 text-slate-300";
  }
};

const labelFor = (
  status: ValorantSeriesStatus | ValorantBindingStatus | ValorantOperationStatus,
  kind: "series" | "binding" | "operation"
): string => {
  if (kind === "binding") {
    return status === "active" ? "Active" : "Detached";
  }
  if (kind === "operation") {
    return operationStatusLabel(status as ValorantOperationStatus);
  }
  return seriesStatusLabel(status as ValorantSeriesStatus);
};

export default function ValorantStatusBadge({
  status,
  kind,
}: {
  status: ValorantSeriesStatus | ValorantBindingStatus | ValorantOperationStatus;
  kind: "series" | "binding" | "operation";
}) {
  return (
    <Badge className={cn(toneFor(status), "whitespace-nowrap")}>
      {labelFor(status, kind)}
    </Badge>
  );
}
