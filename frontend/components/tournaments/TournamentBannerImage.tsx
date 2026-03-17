"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { resolveMediaUrl } from "@/lib/media";

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
      <div className={`coming-soon-block ${className || ""}`.trim()}>
        <span>QUEST</span>
      </div>
    );
  }

  return (
    <img
      src={resolveMediaUrl(bannerUrl)}
      alt={title}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}
