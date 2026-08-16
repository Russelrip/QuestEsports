"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { resolveMediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

export default function TournamentBannerImage({
  bannerUrl,
  title,
  className,
  rounded = true,
  showFallbackTitle = true,
  preload = false,
  loading = "lazy",
}: {
  bannerUrl: string | null;
  title: string;
  className?: string;
  rounded?: boolean;
  showFallbackTitle?: boolean;
  preload?: boolean;
  loading?: ImageProps["loading"];
}) {
  const [hasError, setHasError] = useState(false);

  if (!bannerUrl || hasError) {
    return (
      <div
        className={cn(
          "relative flex h-56 min-w-0 items-end overflow-hidden border border-white/8 bg-[#0d0b16] p-5",
          rounded && "rounded-[24px]",
          className
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(168,85,247,0.2),transparent_38%),linear-gradient(135deg,rgba(192,132,252,0.08),transparent_48%)]" />
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-purple-300/15 shadow-[0_0_50px_rgba(168,85,247,0.14)]" />
        <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-fuchsia-300/20 bg-white/[0.02]" />
        {showFallbackTitle ? <div className="relative min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-fuchsia-100/80">Quest Series</p>
          <p className="mt-2 max-w-full font-display text-2xl text-white [overflow-wrap:anywhere]">{title}</p>
        </div> : null}
      </div>
    );
  }

  return (
    <Image
      src={resolveMediaUrl(bannerUrl)}
      alt={title}
      width={1200}
      height={800}
      unoptimized
      sizes="(min-width: 1280px) 420px, (min-width: 1024px) 380px, 100vw"
      preload={preload}
      loading={preload ? undefined : loading}
      className={cn(rounded && "rounded-[24px]", className)}
      onError={() => setHasError(true)}
    />
  );
}
