import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { resolveMediaUrl } from "@/lib/media";
import type { EventAlbum } from "@/lib/event-albums";

const formatAlbumDate = (value?: string | null) => {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-LK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
};

export default function EventAlbumCard({ album }: { album: EventAlbum }) {
  const date = formatAlbumDate(album.eventDate);
  const remainder = Math.max(0, album.photoCount - album.photos.length);

  return (
    <Link
      href={`/gallery/${album.slug}`}
      className="group block min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
      aria-label={`Open ${album.title}, ${album.photoCount} photos`}
    >
      <Card className="h-full overflow-hidden border-purple-300/10 bg-[#111015] transition duration-300 group-hover:-translate-y-1 group-hover:border-purple-300/35 group-hover:shadow-[0_24px_70px_rgba(168,85,247,0.16)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <div className="flex items-start justify-between gap-4 p-4 pb-3 sm:p-5 sm:pb-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl uppercase tracking-[0.02em] text-purple-200 sm:text-2xl">
              {album.title}
            </h2>
            {album.location || date ? (
              <p className="mt-2 truncate text-xs text-slate-300 sm:text-sm">
                {[album.location, date].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 border border-purple-300/15 bg-black/20 px-3 py-2 text-[11px] font-semibold text-slate-200">
            {album.photoCount} {album.photoCount === 1 ? "Photo" : "Photos"}
          </span>
        </div>

        <div className="grid aspect-[4/5] grid-cols-6 grid-rows-[1.65fr_1fr] gap-px bg-purple-200/15">
          {Array.from({ length: 5 }).map((_, index) => {
            const photo = album.photos[index];
            const className = index < 2 ? "col-span-3" : "col-span-2";
            return (
              <div key={photo?.id || `empty-${index}`} className={`relative overflow-hidden bg-[#09080d] ${className}`}>
                {photo ? (
                  <Image
                    src={resolveMediaUrl(photo.imageAsset.imageUrl)}
                    alt={photo.caption || photo.imageAsset.title || `${album.title} event photo`}
                    fill
                    sizes="(min-width: 1280px) 17vw, (min-width: 768px) 30vw, 50vw"
                    className="object-cover transition duration-500 group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                ) : (
                  <span className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.08),transparent_65%)]" />
                )}
                {index === 4 && remainder > 0 ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-4xl font-bold text-white sm:text-5xl">
                    +{remainder}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </Link>
  );
}
