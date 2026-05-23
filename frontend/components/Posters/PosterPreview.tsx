/* eslint-disable @next/next/no-img-element */

import { ImageAsset, Poster, resolveMediaUrl } from "@/lib/media";

type PosterPreviewDraft = Pick<
  Poster,
  "headline" | "subheadline" | "overlayAlign" | "accentColor" | "textColor"
>;

const alignmentClassName = {
  "top-left": "items-start justify-start",
  "top-right": "items-start justify-end",
  "bottom-left": "items-end justify-start",
  "bottom-right": "items-end justify-end",
} as const;

export default function PosterPreview({
  asset,
  draft,
  fallbackHeadline,
  fallbackSubheadline,
  showOverlay = true,
}: {
  asset: ImageAsset;
  draft: PosterPreviewDraft;
  fallbackHeadline?: string;
  fallbackSubheadline?: string;
  showOverlay?: boolean;
}) {
  const supportingCopy = draft.subheadline || fallbackSubheadline;

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/30">
      <img src={resolveMediaUrl(asset.imageUrl)} alt={asset.title} className="max-h-[70vh] w-full object-cover" />
      {showOverlay ? (
        <div className={`absolute inset-0 flex p-6 sm:p-8 ${alignmentClassName[draft.overlayAlign]}`}>
          <div
            className="max-w-xl rounded-[24px] p-5 shadow-[var(--shadow-md)]"
            style={{
              background: `linear-gradient(135deg, ${draft.accentColor}f0, rgba(4, 1, 11, 0.88))`,
              color: draft.textColor,
            }}
          >
            <h3 className="text-2xl sm:text-3xl">{draft.headline || fallbackHeadline || "Poster headline preview"}</h3>
            {supportingCopy ? <p className="mt-3 text-sm leading-6">{supportingCopy}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
