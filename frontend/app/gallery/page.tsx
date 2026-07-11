import PageLayout from "@/components/PageLayout";
import PostersContent from "@/components/Posters/PostersContent";
import { fetchPublicPosters, type Poster } from "@/lib/media";
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

  try {
    const postersData = await fetchPublicPosters();
    initialPosters = postersData.posters;
  } catch {
    initialPosters = [];
  }

  return (
    <PageLayout title="Gallery" description={defaultPageDescriptions.gallery}>
      <PostersContent initialPosters={initialPosters} />
    </PageLayout>
  );
}
