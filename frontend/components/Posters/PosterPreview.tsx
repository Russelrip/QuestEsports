/* eslint-disable @next/next/no-img-element */

import { ImageAsset, Poster, resolveMediaUrl } from "@/lib/media";

type PosterPreviewDraft = Pick<
  Poster,
  "headline" | "subheadline" | "overlayAlign" | "accentColor" | "textColor"
>;

type PosterPreviewProps = {
  asset: ImageAsset;
  draft: PosterPreviewDraft;
  fallbackHeadline?: string;
  fallbackSubheadline?: string;
  showOverlay?: boolean;
};

export default function PosterPreview({
  asset,
  draft,
  fallbackHeadline,
  fallbackSubheadline,
  showOverlay = true,
}: PosterPreviewProps) {
  const supportingCopy = draft.subheadline || fallbackSubheadline;

  return (
    <div className={`poster-preview poster-preview-${draft.overlayAlign}`}>
      <img src={resolveMediaUrl(asset.imageUrl)} alt={asset.title} />
      {showOverlay ? (
        <div
          className="poster-preview-overlay"
          style={{
            background: `linear-gradient(135deg, ${draft.accentColor}f0, rgba(4, 1, 11, 0.88))`,
            color: draft.textColor,
          }}
        >
          <h3>{draft.headline || fallbackHeadline || "Poster headline preview"}</h3>
          {supportingCopy ? <p>{supportingCopy}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
