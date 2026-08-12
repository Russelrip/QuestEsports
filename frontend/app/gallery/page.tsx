import PageLayout from "@/components/PageLayout";
import EventAlbumsContent from "@/components/gallery/EventAlbumsContent";
import { fetchPublicEventAlbums } from "@/lib/event-albums";
import type { EventAlbum } from "@/lib/event-albums";
import type { MediaPagination } from "@/lib/media";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Event Albums",
  description: defaultPageDescriptions.gallery,
  path: "/gallery",
  keywords: [
    "Quest E-sports event photos",
    "Sri Lanka e-sports gallery",
    "tournament photo albums",
    "gaming event photography",
  ],
});

export default async function GalleryPage() {
  let albums: EventAlbum[] = [];
  let pagination: MediaPagination = { page: 1, pageSize: 12, total: 0, totalPages: 1 };
  let initialError = "";
  let totalPhotos = 0;
  try {
    const result = await fetchPublicEventAlbums(new URLSearchParams({ page: "1", pageSize: "12" }));
    albums = result.albums;
    pagination = result.pagination;
    totalPhotos = result.totalPhotos;
  } catch {
    initialError = "The event albums are temporarily unavailable. Please try again shortly.";
  }

  return (
    <PageLayout title="Gallery" description={defaultPageDescriptions.gallery}>
      <EventAlbumsContent initialAlbums={albums} initialPagination={pagination} initialError={initialError} initialTotalPhotos={totalPhotos} />
    </PageLayout>
  );
}
