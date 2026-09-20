"use client";



export function StatusText({ value }: { value: string }) {
  const tone = ["paid", "free", "approved", "verified", "accepted"].includes(value)
    ? "text-emerald-300"
    : ["rejected", "failed", "flagged", "declined", "cancelled"].includes(value)
      ? "text-rose-300"
      : "text-amber-300";
  return (
    <span className={`text-xs font-semibold uppercase tracking-wider ${tone}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

export function DetailBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="border border-white/10 bg-black/15 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <dl className="mt-4 grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 break-words text-sm text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DataFields({
  title,
  values,
  compact = false,
}: {
  title: string;
  values?: Record<string, string>;
  compact?: boolean;
}) {
  const entries = Object.entries(values || {}).filter(
    ([, value]) => value !== "" && value !== null && value !== undefined,
  );
  if (entries.length === 0) return null;
  return (
    <div className={compact ? "mt-4" : "mt-7"}>
      <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </h4>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([key, value]) => (
          <div key={key} className="border border-white/8 p-3">
            <dt className="text-xs text-slate-500">
              {key.replaceAll("_", " ")}
            </dt>
            <dd className="mt-1 break-words text-sm text-slate-200">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
