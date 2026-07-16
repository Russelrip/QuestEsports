"use client";

import Image from "next/image";
import EmptyState from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Poster, resolveImageAssetUrl } from "@/lib/media";

const posterExternalLinks: Record<string, string> = {
  "VALORANT SHOWDOWN APPRECIATION POST":
    "https://www.facebook.com/share/p/14gNLGrBLWF/?mibextid=wwXIfr",
};

const getPosterExternalLink = (poster: Poster) =>
  posterExternalLinks[poster.title.trim().toUpperCase()] || null;

export default function PosterGallery({
  loading,
  error,
  posters,
  onSelectPoster,
}: {
  loading: boolean;
  error: string;
  posters: Poster[];
  onSelectPoster: (poster: Poster) => void;
}) {
  return (
    <Section className="pt-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Event Gallery</p>
        <h2 className="mt-3 text-3xl text-white">Event photos, tournament moments, and promotional artwork.</h2>
      </div>

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[4/5] rounded-[28px]" />
          ))}
        </div>
      ) : error ? (
        <EmptyState description={error} />
      ) : posters.length === 0 ? (
        <EmptyState description="No gallery photos have been added yet." />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {posters.map((poster) => {
            const externalLink = getPosterExternalLink(poster);
            const card = (
              <Card className="group overflow-hidden transition duration-300 hover:-translate-y-1 hover:border-cyan-300/30 hover:shadow-[0_20px_60px_rgba(34,211,238,0.12)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                <div className="relative aspect-[4/5] overflow-hidden bg-[#070912] p-3">
                  <Image
                    src={resolveImageAssetUrl(poster.imageAsset)}
                    alt={poster.title}
                    fill
                    sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-cyan-950/50 via-transparent to-transparent p-6 opacity-0 transition duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
                    <span className="rounded-full border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white">View full poster</span>
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="text-xl text-white">{poster.title}</h3>
                  {poster.description ? <p className="mt-2 text-sm text-slate-400">{poster.description}</p> : null}
                </div>
              </Card>
            );

            return externalLink ? (
              <a
                key={poster.id}
                href={externalLink}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer rounded-[28px] text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                {card}
              </a>
            ) : (
              <button
                key={poster.id}
                type="button"
                className="cursor-pointer rounded-[28px] text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                onClick={() => onSelectPoster(poster)}
              >
                {card}
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}
