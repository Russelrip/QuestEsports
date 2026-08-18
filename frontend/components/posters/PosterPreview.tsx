import Image from "next/image";
import { applyLegacyImageFallback, ImageAsset, Poster, resolveImageAssetUrl } from "@/lib/media";

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
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-none border border-white/10 bg-black/40">
      <Image
        src={resolveImageAssetUrl(asset) || "/images/logo.png"}
        alt={asset.title}
        fill
        sizes="(min-width: 1024px) 960px, calc(100vw - 2rem)"
        className="object-contain"
        unoptimized
        onError={(event) => { if (!applyLegacyImageFallback(event.currentTarget, asset)) event.currentTarget.style.display = "none"; }}
      />
      {showOverlay ? (
        <div className={`absolute inset-0 flex p-6 sm:p-8 ${alignmentClassName[draft.overlayAlign]}`}>
          <div
            className="max-w-xl rounded-none p-5 shadow-[var(--shadow-md)]"
            style={{
              background: draft.accentColor,
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
