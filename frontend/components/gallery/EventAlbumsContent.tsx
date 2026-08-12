"use client";

import { useState } from "react";
import EventAlbumCard from "@/components/gallery/EventAlbumCard";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { fetchPublicEventAlbums, type EventAlbum } from "@/lib/event-albums";
import type { MediaPagination } from "@/lib/media";

export default function EventAlbumsContent({
  initialAlbums,
  initialPagination,
  initialError = "",
  initialTotalPhotos = 0,
}: {
  initialAlbums: EventAlbum[];
  initialPagination: MediaPagination;
  initialError?: string;
  initialTotalPhotos?: number;
}) {
  const [albums, setAlbums] = useState(initialAlbums);
  const [pagination, setPagination] = useState(initialPagination);
  const [error, setError] = useState(initialError);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalPhotos, setTotalPhotos] = useState(initialTotalPhotos);

  const loadMore = async () => {
    if (loadingMore || pagination.page >= pagination.totalPages) return;
    setLoadingMore(true);
    setError("");
    try {
      const next = await fetchPublicEventAlbums(
        new URLSearchParams({ page: String(pagination.page + 1), pageSize: String(pagination.pageSize) }),
      );
      setAlbums((current) => [
        ...current,
        ...next.albums.filter((album) => !current.some((item) => item.id === album.id)),
      ]);
      setPagination(next.pagination);
      setTotalPhotos(next.totalPhotos);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load more albums.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Section className="pt-5 sm:pt-7" containerClassName="max-w-[100rem]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Event photography</p>
          <h2 className="mt-3 text-3xl uppercase text-white sm:text-4xl">Event Albums</h2>
        </div>
        {albums.length ? (
          <span className="border border-purple-300/20 bg-purple-400/5 px-4 py-2 text-xs font-semibold text-slate-200">
            {pagination.total} {pagination.total === 1 ? "album" : "albums"} · {totalPhotos} photos
          </span>
        ) : null}
      </div>

      {error && !albums.length ? (
        <EmptyState title="Albums unavailable" description={error} />
      ) : albums.length ? (
        <>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {albums.map((album) => <EventAlbumCard key={album.id} album={album} />)}
          </div>
          {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}
          {pagination.page < pagination.totalPages ? (
            <div className="mt-8 flex justify-center">
              <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more albums"}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState title="No event albums yet" description="Event photography will appear here once an album is published." />
      )}
    </Section>
  );
}
