import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-white/8", className)} />;
}

export function TournamentCardSkeleton() {
  return (
    <div className="grid gap-6 rounded-[32px] border border-white/10 bg-[var(--color-card-strong)] p-5 lg:grid-cols-[360px_1fr]">
      <Skeleton className="min-h-72 w-full rounded-[24px]" />
      <div className="grid gap-5">
        <div className="grid gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-[24px]" />
          ))}
        </div>
      </div>
    </div>
  );
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
