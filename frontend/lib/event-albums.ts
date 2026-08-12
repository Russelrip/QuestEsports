import { fetchWithTimeout, parseApiResponse, withServerOriginHeader } from "@/lib/api";
import { resolveMediaUrl, type ImageAsset, type MediaPagination } from "@/lib/media";

export type EventAlbumPhoto = {
  id: string;
  caption?: string | null;
  position: number;
  createdAt: string;
  imageAsset: ImageAsset;
};

export type EventAlbum = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  location?: string | null;
  eventDate?: string | null;
  isPublished: boolean;
  allowDownloads: boolean;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
  photos: EventAlbumPhoto[];
  tournament?: {
    id: string;
    slug: string;
    title: string;
    status: string;
    isPublished: boolean;
  } | null;
};

export const fetchPublicEventAlbums = async (searchParams?: URLSearchParams) => {
  const suffix = searchParams?.toString() ? `?${searchParams.toString()}` : "";
  const response = await fetchWithTimeout(`${resolveMediaUrl("/api/event-albums")}${suffix}`, {
    next: { revalidate: 30 },
    headers: withServerOriginHeader(),
  });
  return parseApiResponse<{ albums: EventAlbum[]; pagination: MediaPagination; totalPhotos: number }>(
    response,
    "Unable to load event albums.",
  );
};

export const fetchPublicEventAlbum = async (slug: string) => {
  const response = await fetchWithTimeout(
    resolveMediaUrl(`/api/event-albums/${encodeURIComponent(slug)}`),
    { next: { revalidate: 30 }, headers: withServerOriginHeader() },
  );
  return parseApiResponse<{ album: EventAlbum }>(response, "Unable to load this event album.").then(
    (payload) => payload.album,
  );
};
