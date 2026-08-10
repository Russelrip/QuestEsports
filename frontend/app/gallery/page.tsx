import PageLayout from "@/components/PageLayout";
import PostersContent from "@/components/posters/PostersContent";
import { fetchPublicPosters, type MediaPagination, type Poster } from "@/lib/media";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Gallery",
  description: defaultPageDescriptions.gallery,
  path: "/gallery",
  keywords: [
    "Quest E-sports event photos",
    "Sri Lanka e-sports gallery",
    "tournament highlights",
    "gaming event photography",
  ],
});

export default async function GalleryPage() {
  let initialPosters: Poster[] = [];
  let initialPagination: MediaPagination = { page: 1, pageSize: 18, total: 0, totalPages: 1 };
  let initialLoadError = "";
  try {
    const postersData = await fetchPublicPosters();
    initialPosters = postersData.posters;
    initialPagination = postersData.pagination;
  } catch {
    initialLoadError = "The gallery is temporarily unavailable. Retrying from your browser.";
  }

  return (
    <PageLayout title="Gallery" description={defaultPageDescriptions.gallery}>
      <PostersContent
        initialPosters={initialPosters}
        initialLoadError={initialLoadError}
        initialPagination={initialPagination}
      />
    </PageLayout>
  );
}
