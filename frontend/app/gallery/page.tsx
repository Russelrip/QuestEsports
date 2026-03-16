import GalleryContent from "@/components/gallery/GalleryContent";
import PageHeader from "@/components/PageHeader";

export default function GalleryPage() {
  return (
    <>
      <PageHeader
        title="Gallery"
        description="Moments from our tournaments and community events"
      />
      <GalleryContent />
    </>
  );
}
