"use client";
/* eslint-disable @next/next/no-img-element */

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
          "relative flex h-56 items-end overflow-hidden rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_20%_18%,rgba(168,85,247,0.32),transparent_28%),linear-gradient(140deg,rgba(47,16,90,0.96),rgba(8,9,16,0.98))] p-5",
          className
        )}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_40%,rgba(0,0,0,0.45))]" />
        <div className="absolute -right-10 top-8 h-36 w-36 rounded-full border border-white/10 bg-fuchsia-400/10 blur-2xl" />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-100/80">Quest Series</p>
          <p className="mt-2 max-w-xs font-display text-2xl text-white">{title}</p>
        </div>
      </div>
    );
  }

  return (
    <img
      src={resolveMediaUrl(bannerUrl)}
      alt={title}
      className={cn("rounded-[24px]", className)}
      onError={() => setHasError(true)}
    />
  );
}
