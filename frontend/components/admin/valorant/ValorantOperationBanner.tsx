"use client";

import { Card } from "@/components/ui/card";
import type { QuestValorantOperation } from "@/lib/valorant";

export default function ValorantOperationBanner({
  operation,
  inFlight,
}: {
  operation: QuestValorantOperation | null;
  inFlight: boolean;
}) {
  if (inFlight) {
    return (
      <Card role="status" className="border-amber-300/20 bg-amber-400/10 px-5 py-4 text-sm font-medium text-amber-100">
        Applying changes — do not refresh
      </Card>
    );
  }

  if (operation?.status === "reconciliation_required") {
    return (
      <Card role="status" className="border-amber-300/20 bg-amber-400/10 px-5 py-4">
        <h3 className="text-sm font-semibold text-amber-100">Finalization result unknown</h3>
        <p className="mt-1 text-sm text-amber-100/80">
          The platform did not confirm the result. Use &apos;Re-check status&apos; to read the current state.
          This action never retries automatically.
        </p>
        {operation.errorCode || operation.fastapiRequestId ? (
          <p className="mt-2 font-mono text-xs text-amber-100/70">
            {[operation.errorCode, operation.fastapiRequestId && `request ${operation.fastapiRequestId}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </Card>
    );
  }

  if (operation?.status === "failed") {
    return (
      <Card role="alert" className="border-red-400/25 bg-red-500/12 px-5 py-4">
        <h3 className="text-sm font-semibold text-red-100">Last action failed</h3>
        {operation.errorCode ? (
          <p className="mt-1 text-sm text-red-100/80">{operation.errorCode}</p>
        ) : null}
      </Card>
    );
  }

  return null;
}
