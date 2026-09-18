import Image from "next/image";
import { resolveImageUrl } from "@/lib/media";
import type { EventSeries, TournamentSponsor } from "@/lib/tournaments";

// A belt copy has to be wider than the viewport or the loop shows a gap, so a
// short sponsor list is repeated until each copy holds at least this many logos.
const MIN_LOGOS_PER_COPY = 8;
const SECONDS_PER_LOGO = 4;

// Sponsors live on the child tournaments; the same brand often backs several
// games, so collapse them to one logo each in first-seen order.
export const collectEventSponsors = (event: EventSeries): TournamentSponsor[] => {
  const seen = new Set<string>();
  const sponsors: TournamentSponsor[] = [];
  for (const tournament of event.tournaments) {
    for (const sponsor of tournament.sponsors ?? []) {
      const key = sponsor.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sponsors.push(sponsor);
    }
  }
  return sponsors;
};

function SponsorLogo({ sponsor, hidden }: { sponsor: TournamentSponsor; hidden: boolean }) {
  const logoUrl = resolveImageUrl(sponsor.logoUrl);
  const logo = logoUrl ? (
    <Image src={logoUrl} alt="" width={240} height={96} unoptimized className="h-14 w-auto max-w-44 object-contain transition duration-300 group-hover:scale-105 motion-reduce:transition-none sm:h-16 sm:max-w-52" />
  ) : (
    <span className="font-display text-3xl font-bold text-white">{sponsor.name.slice(0, 2).toUpperCase()}</span>
  );
  // Same three lines as the sponsor panel on the tournament page: role, logo, name.
  const mark = (
    <>
      <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-purple-200 sm:text-sm">{sponsor.partnershipLabel || "Official Sponsor"}</span>
      <span className="flex h-16 items-center justify-center sm:h-20">{logo}</span>
      <span className="font-display text-sm font-bold uppercase tracking-[0.1em] text-white sm:text-base">{sponsor.name}</span>
    </>
  );
  const className = "group flex w-52 shrink-0 flex-col items-center justify-center gap-2 border-r border-white/10 px-6 py-2 text-center transition hover:bg-white/5 motion-reduce:transition-none sm:w-64 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300";
  // Repeats keep their link for mouse users but stay out of the tab order and
  // the accessibility tree, so each sponsor is announced and focused once.
  const repeatProps = hidden ? { "aria-hidden": true, tabIndex: -1 } : {};
  return sponsor.websiteUrl ? (
    <a href={sponsor.websiteUrl} target="_blank" rel="noreferrer" aria-label={hidden ? undefined : `Visit ${sponsor.name}`} className={className} {...repeatProps}>{mark}</a>
  ) : (
    <div className={className} {...(hidden ? { "aria-hidden": true } : {})}>{mark}</div>
  );
}

export default function EventSponsorBelt({ event }: { event: EventSeries }) {
  const sponsors = collectEventSponsors(event);
  if (!sponsors.length) return null;

  const repeats = Math.ceil(MIN_LOGOS_PER_COPY / sponsors.length);
  const copy = Array.from({ length: repeats }, () => sponsors).flat();
  const duration = `${copy.length * SECONDS_PER_LOGO}s`;

  return (
    <div className="relative border-t border-white/10 bg-black/30 backdrop-blur-sm">
      <p className="sr-only">Event sponsors</p>
      <div className="sponsor-belt relative overflow-hidden py-4 sm:py-5 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
        <div className="sponsor-belt-track flex w-max" style={{ ["--sponsor-belt-duration" as string]: duration }}>
          {[0, 1].map((pass) => (
            <div key={pass} className="flex shrink-0 items-center">
              {copy.map((sponsor, index) => (
                <SponsorLogo key={`${sponsor.id}-${index}`} sponsor={sponsor} hidden={pass === 1 || index >= sponsors.length} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
