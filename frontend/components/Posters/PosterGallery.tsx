"use client";
/* eslint-disable @next/next/no-img-element */

import EmptyState from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Poster, resolveMediaUrl } from "@/lib/media";

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
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Poster Library</p>
        <h2 className="mt-3 text-3xl text-white">Promotional artwork and tournament visuals.</h2>
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
        <EmptyState description="No posters have been created yet." />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {posters.map((poster) => (
            <button key={poster.id} type="button" className="text-left" onClick={() => onSelectPoster(poster)}>
              <Card className="group overflow-hidden">
                <div className="relative aspect-[4/5] overflow-hidden">
                  <img
                    src={resolveMediaUrl(poster.imageAsset.imageUrl)}
                    alt={poster.title}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="p-5">
                  <h3 className="text-xl text-white">{poster.title}</h3>
                  {poster.description ? <p className="mt-2 text-sm text-slate-400">{poster.description}</p> : null}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
