"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Pagination } from "@/lib/admin";

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-3xl text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-400">{detail}</p>
    </Card>
  );
}
export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl text-white">{value}</p>
    </div>
  );
}
export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  );
}
export function Pager({
  pagination,
  setPage,
}: {
  pagination: Pagination | null;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-white/10 p-4">
      <p className="text-sm text-slate-400">
        Page {pagination.page} of {pagination.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pagination.page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
