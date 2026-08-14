"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ValorantErrorAlert({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card role="alert" className="px-5 py-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{message}</p>
      {onRetry ? (
        <Button type="button" variant="ghost" onClick={onRetry} className="mt-3">
          Retry
        </Button>
      ) : null}
    </Card>
  );
}
