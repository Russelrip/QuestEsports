import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";

export type TournamentGridCardMeta = { label: string; value: string };

export type TournamentGridCardStatusTone = "open" | "muted" | "closed";

const statusToneClassName: Record<TournamentGridCardStatusTone, string> = {
  open: "text-emerald-300",
  muted: "text-slate-300",
  closed: "text-rose-400",
};

/**
 * The single card shape behind every tournament-style tile: the `/tournaments`
 * grid, the event cards that now sit in that same grid, and the game lineup
 * inside an event. Callers supply the destination and the four meta slots, so an
 * event and a tournament read identically without either owning the chrome.
 */
export default function TournamentGridCard({
  href,
  bannerUrl,
  title,
  meta,
  statusLabel,
  statusTone,
  badge,
  preload = false,
  eager = false,
}: {
  href: string;
  bannerUrl: string | null;
  title: string;
  meta: TournamentGridCardMeta[];
  statusLabel: string;
  statusTone: TournamentGridCardStatusTone;
  badge?: string;
  preload?: boolean;
  eager?: boolean;
}) {
  return <Link href={href} prefetch={false} className="group relative flex h-full flex-col overflow-hidden border border-white/10 bg-[#0d0c13]">
    <div className="relative aspect-[4/3] overflow-hidden bg-[#09080e]">
      <TournamentBannerImage bannerUrl={bannerUrl} title={title} rounded={false} showFallbackTitle={false} preload={preload} loading={eager ? "eager" : "lazy"} className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-85 motion-reduce:transition-none" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/25 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none" />
      {badge ? <span className="absolute left-4 top-4 border border-purple-300/40 bg-black/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-purple-100 backdrop-blur">{badge}</span> : null}
    </div>
    <div className="bg-[#0d0c13] px-5 py-5"><h3 className="line-clamp-2 min-h-16 text-xl font-bold uppercase leading-8 text-white transition-colors group-hover:text-[var(--interactive-text)]">{title}</h3></div>
    <dl className="grid flex-1 grid-cols-2 bg-[#0d0c13] text-xs [&>div:nth-child(-n+2)]:bg-white/[0.025]">{meta.map((item) => <Meta key={item.label} label={item.label} value={item.value} />)}</dl>
    <div className="flex items-center justify-center bg-black/25 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.1em]"><span className={`whitespace-nowrap ${statusToneClassName[statusTone]}`}>{statusLabel}</span></div>
  </Link>;
}

function Meta({ label, value }: TournamentGridCardMeta) { return <div className="min-w-0 px-5 py-4"><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt><dd className="mt-2 line-clamp-1 text-[15px] font-semibold text-white">{value}</dd></div>; }
