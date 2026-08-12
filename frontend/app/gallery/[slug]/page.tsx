import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import EventAlbumBrowser from "@/components/gallery/EventAlbumBrowser";
import { PageTransition } from "@/components/ui/page-transition";
import { ApiRequestError } from "@/lib/api";
import { fetchPublicEventAlbum } from "@/lib/event-albums";
import type { EventAlbum } from "@/lib/event-albums";
import { buildPageMetadata } from "@/lib/site";

const getAlbum = cache(fetchPublicEventAlbum);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const album = await getAlbum(slug);
    return buildPageMetadata({
      title: album.title,
      description: album.description || `Browse ${album.photoCount} photos from ${album.title}.`,
      path: `/gallery/${album.slug}`,
      keywords: [album.title, "Quest E-sports event photos", "Sri Lanka esports photography"],
    });
  } catch {
    return { title: "Event Album Not Found", robots: { index: false, follow: false } };
  }
}

export default async function EventAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ photo?: string }>;
}) {
  const { slug } = await params;
  const { photo } = await searchParams;
  let album: EventAlbum;
  try {
    album = await getAlbum(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }
  return <PageTransition><EventAlbumBrowser album={album} initialPhotoId={photo} /></PageTransition>;
}
