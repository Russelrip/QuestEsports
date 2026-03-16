import GalleryContent from "@/components/gallery/GalleryContent";
import PageHeader from "@/components/PageHeader";

export default function GalleryPage() {
  return (
    <>
      {/* Reuse the shared page header component for consistent inner-page branding. */}
      <PageHeader
        title="Gallery"
        description="Moments from our tournaments and community events"
      />
      <GalleryContent />
    </>
  );
}
