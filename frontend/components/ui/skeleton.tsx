import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-white/8", className)} />;
}

export function ProfileSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
      <Skeleton className="min-h-[360px] rounded-[32px]" />
      <Skeleton className="min-h-[520px] rounded-[32px]" />
    </div>
  );
}

export function AdminTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-[32px] border border-white/10 bg-[var(--color-card-strong)] p-5">
      <div className="grid gap-3">
        <Skeleton className="h-10 w-48" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-[20px]" />
        ))}
      </div>
    </div>
  );
}
