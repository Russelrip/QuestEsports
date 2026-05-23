"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import AdminPosterStudio from "@/components/Posters/AdminPosterStudio";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import MediaModal from "@/components/Posters/MediaModal";
import PosterGallery from "@/components/Posters/PosterGallery";
import PosterPreview from "@/components/Posters/PosterPreview";
import { useToastStore } from "@/hooks/useToastStore";
import { fetchImages, fetchPosters, ImageAsset, Poster } from "@/lib/media";
import {
  buildUploadPreviews,
  deletePoster,
  exportPosterPng,
  initialPosterDraft,
  revokeUploadPreviews,
  savePoster,
  uploadImages,
  UploadPreview,
} from "@/lib/poster-studio";

export default function PostersContent() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const showToast = useToastStore((state) => state.showToast);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [posters, setPosters] = useState<Poster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPoster, setSelectedPoster] = useState<Poster | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadPreviews, setUploadPreviews] = useState<UploadPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [posterDraft, setPosterDraft] = useState(initialPosterDraft);
  const [posterSaving, setPosterSaving] = useState(false);
  const [posterSuccess, setPosterSuccess] = useState("");
  const [deletingPosterId, setDeletingPosterId] = useState("");

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const postersData = await fetchPosters();
      setPosters(postersData.posters);

      if (!authLoading && isAdmin) {
        const imagesData = await fetchImages();
        setImages(imagesData.images);
        setPosterDraft((current) => ({
          ...current,
          imageAssetId:
            current.imageAssetId ||
            imagesData.images[0]?.id ||
            postersData.posters[0]?.imageAsset.id ||
            "",
        }));
      } else {
        setImages([]);
        setPosterDraft((current) => ({
          ...current,
          imageAssetId: current.imageAssetId || postersData.posters[0]?.imageAsset.id || "",
        }));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load posters.");
      showToast({
        tone: "error",
        title: "Unable to load posters",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setLoading(false);
    }
  }, [authLoading, isAdmin, showToast]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  useEffect(
    () => () => {
      revokeUploadPreviews(uploadPreviews);
    },
    [uploadPreviews]
  );

  const resetMessages = () => {
    setError("");
    setUploadSuccess("");
    setPosterSuccess("");
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    resetMessages();
    setUploadPreviews((current) => {
      revokeUploadPreviews(current);
      return buildUploadPreviews(files);
    });
  };

  const handleUploadSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploading(true);
    resetMessages();

    try {
      const nextImages = await uploadImages({
        title:
          uploadTitle.trim() ||
          uploadPreviews[0]?.file.name.replace(/\.[^.]+$/, "") ||
          "Poster image",
        previews: uploadPreviews,
      });

      setImages((current) => [...nextImages, ...current]);
      setPosterDraft((current) => ({
        ...current,
        imageAssetId: nextImages[0]?.id || current.imageAssetId,
      }));
      setUploadSuccess(`${nextImages.length} image${nextImages.length > 1 ? "s" : ""} uploaded.`);
      showToast({
        tone: "success",
        title: "Images uploaded",
        description: `${nextImages.length} image${nextImages.length > 1 ? "s" : ""} uploaded.`,
      });
      setUploadTitle("");
      setUploadPreviews((current) => {
        revokeUploadPreviews(current);
        return [];
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to upload images.");
      showToast({
        tone: "error",
        title: "Upload failed",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handlePosterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPosterSaving(true);
    resetMessages();

    try {
      const createdPoster = await savePoster(posterDraft);
      setPosters((current) => [createdPoster, ...current]);
      setSelectedPoster(createdPoster);
      setPosterSuccess("Poster entry saved.");
      showToast({ tone: "success", title: "Poster saved" });
      setPosterDraft((current) => ({
        ...current,
        title: "",
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create poster.");
      showToast({
        tone: "error",
        title: "Unable to save poster",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setPosterSaving(false);
    }
  };

  const handleExport = async (asset: ImageAsset, draft: Poster) => {
    try {
      await exportPosterPng(asset, draft);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to export poster.");
      showToast({
        tone: "error",
        title: "Export failed",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  const handleDeletePoster = async (poster: Poster) => {
    if (!window.confirm(`Delete "${poster.title}"?`)) {
      return;
    }

    setDeletingPosterId(poster.id);
    setError("");

    try {
      await deletePoster(poster.id);
      setPosters((current) => current.filter((item) => item.id !== poster.id));
      setSelectedPoster((current) => (current?.id === poster.id ? null : current));
      showToast({ tone: "success", title: "Poster deleted" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete poster.");
      showToast({
        tone: "error",
        title: "Delete failed",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      setDeletingPosterId("");
    }
  };

  const selectedDraftAsset =
    images.find((image) => image.id === posterDraft.imageAssetId) ||
    posters.find((poster) => poster.imageAsset.id === posterDraft.imageAssetId)?.imageAsset ||
    null;

  return (
    <>
      {isAdmin ? (
        <AdminPosterStudio
          images={images}
          uploadTitle={uploadTitle}
          uploadPreviews={uploadPreviews}
          uploading={uploading}
          uploadSuccess={uploadSuccess}
          posterDraft={posterDraft}
          posterSaving={posterSaving}
          posterSuccess={posterSuccess}
          selectedDraftAsset={selectedDraftAsset}
          error={error}
          onUploadTitleChange={setUploadTitle}
          onFileSelection={handleFileSelection}
          onUploadSubmit={handleUploadSubmit}
          onPosterDraftChange={(updates) =>
            setPosterDraft((current) => ({
              ...current,
              ...updates,
            }))
          }
          onPosterSubmit={handlePosterSubmit}
        />
      ) : null}

      <PosterGallery
        loading={loading}
        authLoading={authLoading}
        error={error}
        posters={posters}
        onSelectPoster={setSelectedPoster}
      />

      {selectedPoster ? (
        <MediaModal onClose={() => setSelectedPoster(null)}>
          <PosterPreview
            asset={selectedPoster.imageAsset}
            draft={selectedPoster}
            showOverlay={false}
          />
          <div className="mt-5 grid gap-4">
            <div>
              <p className="text-xl font-semibold text-white">{selectedPoster.title}</p>
              {selectedPoster.description ? <p className="mt-2 text-sm text-slate-400">{selectedPoster.description}</p> : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleExport(selectedPoster.imageAsset, selectedPoster)}
              >
                Download PNG
              </Button>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void handleDeletePoster(selectedPoster)}
                  disabled={deletingPosterId === selectedPoster.id}
                >
                  {deletingPosterId === selectedPoster.id ? "Deleting..." : "Delete Poster"}
                </Button>
              ) : null}
            </div>
          </div>
        </MediaModal>
      ) : null}
    </>
  );
}
