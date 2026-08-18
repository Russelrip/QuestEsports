"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { apiFetch } from "@/lib/auth";
import { getDownloadFilename } from "@/lib/download-filename";
import { fetchPublicEventAlbum, type EventAlbum } from "@/lib/event-albums";
import { resolveImageUrl } from "@/lib/media";

const formatEventDate = (value?: string | null) => {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-LK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
};

const updatePhotoQuery = (photoId?: string) => {
  const url = new URL(window.location.href);
  if (photoId) url.searchParams.set("photo", photoId);
  else url.searchParams.delete("photo");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

export default function EventAlbumBrowser({
  album,
  initialPhotoId,
}: {
  album: EventAlbum;
  initialPhotoId?: string;
}) {
  const initialIndex = useMemo(
    () => Math.max(-1, album.photos.findIndex((photo) => photo.id === initialPhotoId)),
    [album.photos, initialPhotoId],
  );
  const [photos, setPhotos] = useState(album.photos);
  const [photoPagination, setPhotoPagination] = useState(album.photoPagination);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const touchStartX = useRef<number | null>(null);
  const selectedPhoto = selectedIndex >= 0 ? photos[selectedIndex] : null;

  const selectPhoto = useCallback((index: number) => {
    const normalized = (index + photos.length) % photos.length;
    setSelectedIndex(normalized);
    updatePhotoQuery(photos[normalized].id);
  }, [photos]);

  const loadMorePhotos = async () => {
    if (!photoPagination || loadingMore || photoPagination.page >= photoPagination.totalPages) return;
    setLoadingMore(true);
    setLoadError("");
    try {
      const nextAlbum = await fetchPublicEventAlbum(album.slug, {
        page: photoPagination.page + 1,
        pageSize: photoPagination.pageSize,
      });
      setPhotos((current) => [
        ...current,
        ...nextAlbum.photos.filter((photo) => !current.some((item) => item.id === photo.id)),
      ]);
      setPhotoPagination(nextAlbum.photoPagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load more photos.");
    } finally {
      setLoadingMore(false);
    }
  };

  const closeLightbox = useCallback(() => {
    setSelectedIndex(-1);
    setDownloadError("");
    updatePhotoQuery();
  }, []);

  useEffect(() => {
    if (
      !initialPhotoId ||
      photos.some((photo) => photo.id === initialPhotoId) ||
      !photoPagination ||
      photoPagination.page >= photoPagination.totalPages
    ) return;

    let cancelled = false;
    const loadLinkedPhoto = async () => {
      setLoadingMore(true);
      setLoadError("");
      let combined = photos;
      let pagination = photoPagination;
      try {
        while (pagination.page < pagination.totalPages) {
          const nextAlbum = await fetchPublicEventAlbum(album.slug, {
            page: pagination.page + 1,
            pageSize: pagination.pageSize,
          });
          combined = [
            ...combined,
            ...nextAlbum.photos.filter((photo) => !combined.some((item) => item.id === photo.id)),
          ];
          if (nextAlbum.photoPagination) pagination = nextAlbum.photoPagination;
          const linkedIndex = combined.findIndex((photo) => photo.id === initialPhotoId);
          if (linkedIndex >= 0) {
            if (!cancelled) {
              setPhotos(combined);
              setPhotoPagination(pagination);
              setSelectedIndex(linkedIndex);
            }
            return;
          }
          if (!nextAlbum.photoPagination) break;
        }
        if (!cancelled) {
          setPhotos(combined);
          setPhotoPagination(pagination);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Unable to open the linked photo.");
        }
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    };
    void loadLinkedPhoto();
    return () => { cancelled = true; };
  }, [album.slug, initialPhotoId, photoPagination, photos]);

  useEffect(() => {
    if (!selectedPhoto) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") selectPhoto(selectedIndex - 1);
      if (event.key === "ArrowRight") selectPhoto(selectedIndex + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeLightbox, selectPhoto, selectedIndex, selectedPhoto]);

  const downloadSelected = async () => {
    if (!selectedPhoto || !album.allowDownloads || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const resolvedImageUrl = resolveImageUrl(selectedPhoto.imageAsset.imageUrl);
      if (!resolvedImageUrl) throw new Error("Unable to download this photo.");

      const downloadUrl = new URL(resolvedImageUrl, window.location.origin);
      downloadUrl.searchParams.append("download", "original");
      const response = await apiFetch(downloadUrl.toString(), {
        timeoutMs: 60_000,
      });
      if (!response.ok) throw new Error("Unable to download this photo.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = getDownloadFilename({
          contentDisposition: response.headers.get("Content-Disposition"),
          contentType: blob.type || response.headers.get("Content-Type"),
          originalName: selectedPhoto.imageAsset.originalName,
          fallbackName: `${album.slug}-${selectedPhoto.id}`,
        });
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to download this photo.");
    } finally {
      setDownloading(false);
    }
  };

  const date = formatEventDate(album.eventDate);

  return (
    <>
      <Section className="pt-5 sm:pt-7" containerClassName="max-w-[112rem]">
        <div className="mb-6 flex flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link href="/gallery" className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-200 transition hover:text-white">
              ← Event albums
            </Link>
            <h1 className="mt-4 break-words text-3xl uppercase text-white sm:text-5xl">{album.title}</h1>
            {album.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">{album.description}</p> : null}
            {album.location || date ? (
              <p className="mt-3 text-sm text-slate-300">{[album.location, date].filter(Boolean).join(" · ")}</p>
            ) : null}
          </div>
          <span className="shrink-0 border border-purple-300/20 bg-purple-400/5 px-4 py-2 text-sm font-semibold text-slate-200">
            {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
          </span>
        </div>

        {photos.length ? (
          <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => selectPhoto(index)}
                className="group relative aspect-square overflow-hidden bg-[#0c0b10] text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-purple-300"
                aria-label={`Open photo ${index + 1} of ${album.photoCount}`}
              >
                <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,#0c0b10_25%,#1a1422_45%,#0c0b10_65%)] bg-[length:200%_100%]" />
                <Image
                  src={resolveImageUrl(photo.imageAsset.imageUrl) || "/images/logo.png"}
                  alt={photo.caption || photo.imageAsset.title || `${album.title} photo ${index + 1}`}
                  fill
                  sizes="(min-width: 1536px) 14vw, (min-width: 1280px) 17vw, (min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover transition duration-300 group-hover:scale-[1.035] group-hover:brightness-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  unoptimized
                  onError={(event) => {
                    const image = event.currentTarget;
                    if (image.dataset.fallbackApplied === "true") image.style.display = "none";
                    else {
                      image.dataset.fallbackApplied = "true";
                      image.src = "/images/logo.png";
                    }
                  }}
                />
              </button>
            ))}
          </div>
          {loadError ? <p className="mt-5 text-center text-sm text-rose-300">{loadError}</p> : null}
          {photoPagination && photoPagination.page < photoPagination.totalPages ? (
            <div className="mt-8 flex justify-center">
              <Button type="button" variant="secondary" onClick={() => void loadMorePhotos()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : `Load more photos (${photos.length} of ${album.photoCount})`}
              </Button>
            </div>
          ) : null}
          </>
        ) : (
          <div className="border border-white/10 bg-[#0d0c13] p-10 text-center text-sm text-slate-400">
            This album does not have any published photos yet.
          </div>
        )}
      </Section>

      {selectedPhoto ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${album.title} photo viewer`}
          className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm"
          onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchStartX.current === null) return;
            const difference = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(difference) < 55) return;
            selectPhoto(difference > 0 ? selectedIndex - 1 : selectedIndex + 1);
          }}
        >
          <div className="flex min-h-16 items-center justify-between gap-4 border-b border-white/10 bg-black/80 px-4 sm:px-6">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{album.title}</p>
              <p className="text-xs text-slate-400">{selectedIndex + 1} / {album.photoCount}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {album.allowDownloads ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void downloadSelected()} disabled={downloading} aria-label="Download current photo">
                  <span aria-hidden="true">↓</span>
                  <span className="hidden sm:inline">{downloading ? "Downloading…" : "Download"}</span>
                </Button>
              ) : null}
              <button type="button" onClick={closeLightbox} className={buttonClassName({ variant: "secondary", size: "sm", className: "w-10 px-0 text-xl" })} aria-label="Close photo viewer">
                ×
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1" onClick={(event) => { if (event.target === event.currentTarget) closeLightbox(); }}>
            <Image
              key={selectedPhoto.id}
              src={resolveImageUrl(selectedPhoto.imageAsset.imageUrl) || "/images/logo.png"}
              alt={selectedPhoto.caption || selectedPhoto.imageAsset.title || `${album.title} event photo`}
              fill
              priority
              sizes="100vw"
              className="select-none object-contain p-2 sm:p-5"
              unoptimized
              onError={(event) => {
                const image = event.currentTarget;
                if (image.dataset.fallbackApplied === "true") image.style.display = "none";
                else {
                  image.dataset.fallbackApplied = "true";
                  image.src = "/images/logo.png";
                }
              }}
            />
            {photos.length > 1 ? (
              <>
                <button type="button" onClick={() => selectPhoto(selectedIndex - 1)} className="absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center border border-white/15 bg-black/60 text-3xl text-white transition hover:bg-purple-500/60 sm:left-5 sm:size-14" aria-label="Previous photo">‹</button>
                <button type="button" onClick={() => selectPhoto(selectedIndex + 1)} className="absolute right-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center border border-white/15 bg-black/60 text-3xl text-white transition hover:bg-purple-500/60 sm:right-5 sm:size-14" aria-label="Next photo">›</button>
              </>
            ) : null}
          </div>
          {downloadError ? <p className="border-t border-rose-400/20 bg-rose-500/10 px-4 py-2 text-center text-xs text-rose-200">{downloadError}</p> : null}
          {selectedPhoto.caption ? <p className="border-t border-white/10 bg-black/80 px-4 py-3 text-center text-sm text-slate-300">{selectedPhoto.caption}</p> : null}
        </div>
      ) : null}
    </>
  );
}
