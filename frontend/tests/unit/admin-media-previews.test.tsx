import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPosterStudio from "../../components/posters/AdminPosterStudio";
import type { ImageAsset } from "../../lib/media";
import type { UploadPreview } from "../../lib/poster-studio";

const asset: ImageAsset = {
  id: "asset-1",
  title: "Grand final poster",
  category: "poster",
  contentType: "image/png",
  createdAt: "2026-08-19T12:00:00.000Z",
  imageUrl: "/uploads/poster-images/grand-final.png",
};

const uploadPreview = (name: string): UploadPreview => ({
  file: new File(["poster"], name, { type: "image/png" }),
  previewUrl: `blob:https://admin.example/${name}`,
});

const renderStudio = (overrides: Partial<React.ComponentProps<typeof AdminPosterStudio>> = {}) => render(
  <AdminPosterStudio
    images={[asset]}
    uploadTitle=""
    uploadPreviews={[uploadPreview("grand-final.png")]}
    uploading={false}
    uploadSuccess=""
    posterDraft={{ title: "Grand final", imageAssetId: asset.id, tournamentId: "tournament-1" }}
    posterSaving={false}
    posterSuccess=""
    selectedDraftAsset={asset}
    error=""
    onUploadTitleChange={vi.fn()}
    onFileSelection={vi.fn()}
    onUploadSubmit={vi.fn()}
    onPosterDraftChange={vi.fn()}
    onPosterSubmit={vi.fn()}
    tournaments={[{ id: "tournament-1", slug: "cup", title: "Quest Cup", status: "published", isPublished: true }]}
    {...overrides}
  />,
);

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin media previews", () => {
  it("renders upload and draft previews as real images with accessible names", () => {
    renderStudio();

    const uploadPreviewImage = screen.getByAltText("grand-final.png");
    expect(uploadPreviewImage.tagName).toBe("IMG");
    expect(uploadPreviewImage).toHaveAttribute("src", "blob:https://admin.example/grand-final.png");

    const draftImage = screen.getByAltText("Grand final poster");
    expect(draftImage.tagName).toBe("IMG");
    expect(draftImage.getAttribute("src")).toContain("grand-final.png");
  });

  it("renders previews without React or Next image warnings", () => {
    renderStudio();

    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("falls back to the Quest logo when a draft asset has no resolvable URL", () => {
    renderStudio({ selectedDraftAsset: { ...asset, imageUrl: "" } });

    expect(screen.getByAltText("Grand final poster").getAttribute("src")).toContain("/images/logo.png");
  });
});
