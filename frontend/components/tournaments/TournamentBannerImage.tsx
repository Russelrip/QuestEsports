"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveMediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

export default function TournamentBannerImage({
  bannerUrl,
  title,
  className,
}: {
  bannerUrl: string | null;
  title: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!bannerUrl || hasError) {
    return (
      <div
        className={cn(
          "relative flex h-56 min-w-0 items-end overflow-hidden rounded-[24px] border border-white/8 bg-[#120d1d] p-5",
          className
        )}
      >
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute right-0 top-8 h-36 w-36 rounded-full border border-white/10 bg-fuchsia-400/10 blur-2xl" />
        <div className="relative min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-fuchsia-100/80">Quest Series</p>
          <p className="mt-2 max-w-full font-display text-2xl text-white [overflow-wrap:anywhere]">{title}</p>
        </div>
      </div>
    );
  }

  return (
    <Image
      src={resolveMediaUrl(bannerUrl)}
      alt={title}
      width={1200}
      height={800}
      sizes="(min-width: 1280px) 420px, (min-width: 1024px) 380px, 100vw"
      className={cn("rounded-[24px]", className)}
      onError={() => setHasError(true)}
    />
  );
}
