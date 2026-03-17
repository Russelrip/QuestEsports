"use client";
/* eslint-disable @next/next/no-img-element */

import EmptyState from "@/components/ui/EmptyState";
import { Poster, resolveMediaUrl } from "@/lib/media";

type PosterGalleryProps = {
  loading: boolean;
  authLoading: boolean;
  error: string;
  posters: Poster[];
  onSelectPoster: (poster: Poster) => void;
};

export default function PosterGallery({
  loading,
  authLoading,
  error,
  posters,
  onSelectPoster,
}: PosterGalleryProps) {
  return (
    <section className="gallery-section">
      <div className="container">
        {loading || authLoading ? (
          <EmptyState description="Loading posters..." />
        ) : error ? (
          <EmptyState description={error} />
        ) : posters.length === 0 ? (
          <EmptyState description="No posters have been created yet." />
        ) : (
          <div className="gallery-grid">
            {posters.map((poster) => (
              <button
                key={poster.id}
                type="button"
                className="gallery-item gallery-popup-item media-gallery-button"
                onClick={() => onSelectPoster(poster)}
              >
                <img src={resolveMediaUrl(poster.imageAsset.imageUrl)} alt={poster.title} />
                <div className="gallery-overlay">
                  <h3>{poster.title}</h3>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
