"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import AdminPosterStudio from "@/components/posters/AdminPosterStudio";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import MediaModal from "@/components/posters/MediaModal";
import PosterGallery from "@/components/posters/PosterGallery";
import PosterPreview from "@/components/posters/PosterPreview";
import { useToastStore } from "@/hooks/useToastStore";
import { fetchImages, fetchPosters, ImageAsset, MediaPagination, Poster } from "@/lib/media";
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

export default function PostersContent({
  initialPosters = [],
  initialLoadError = "",
  initialPagination = { page: 1, pageSize: 18, total: initialPosters.length, totalPages: 1 },
}: {
  initialPosters?: Poster[];
  initialLoadError?: string;
  initialPagination?: MediaPagination;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const showToast = useToastStore((state) => state.showToast);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [posters, setPosters] = useState<Poster[]>(initialPosters);
  const [loading, setLoading] = useState(initialPosters.length === 0);
  const [pagination, setPagination] = useState(initialPagination);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(initialLoadError);
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
    const shouldFetchPosters = initialPosters.length === 0 || isAdmin;
    const shouldFetchImages = !authLoading && isAdmin;

    if (!shouldFetchPosters && !shouldFetchImages) {
      setLoading(false);
      return;
    }

    if (shouldFetchPosters) {
      setLoading(true);
    }
    setError("");

    try {
      let postersData = null;

      if (shouldFetchPosters) {
        postersData = await fetchPosters(new URLSearchParams({ page: "1", pageSize: "18" }));
        setPosters(postersData.posters);
        setPagination(postersData.pagination);
      }

      if (shouldFetchImages) {
        const firstImagesPage = await fetchImages(new URLSearchParams({ page: "1", pageSize: "60" }));
        const allImages = [...firstImagesPage.images];
        for (let page = 2; page <= firstImagesPage.pagination.totalPages; page += 1) {
          const nextPage = await fetchImages(new URLSearchParams({ page: String(page), pageSize: "60" }));
          allImages.push(...nextPage.images);
        }
        setImages(allImages);
        setPosterDraft((current) => ({
          ...current,
          imageAssetId:
            current.imageAssetId ||
            allImages[0]?.id ||
            postersData?.posters[0]?.imageAsset.id ||
            initialPosters[0]?.imageAsset.id ||
            "",
        }));
      } else {
        setImages([]);
        setPosterDraft((current) => ({
          ...current,
          imageAssetId:
            current.imageAssetId ||
            postersData?.posters[0]?.imageAsset.id ||
            initialPosters[0]?.imageAsset.id ||
            "",
        }));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load gallery.");
      showToast({
        tone: "error",
        title: "Unable to load gallery",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    } finally {
      if (shouldFetchPosters) {
        setLoading(false);
      }
    }
  }, [authLoading, initialPosters, isAdmin, showToast]);

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
          "Gallery image",
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
      setPosterSuccess("Gallery entry published.");
      showToast({ tone: "success", title: "Gallery entry published" });
      setPosterDraft((current) => ({
        ...current,
        title: "",
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create gallery entry.");
      showToast({
        tone: "error",
        title: "Unable to publish gallery entry",
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
      showToast({ tone: "success", title: "Gallery entry deleted" });
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

  const handleLoadMore = async () => {
    if (loadingMore || pagination.page >= pagination.totalPages) return;
    setLoadingMore(true);
    setError("");
    try {
      const next = await fetchPosters(
        new URLSearchParams({ page: String(pagination.page + 1), pageSize: String(pagination.pageSize) }),
      );
      setPosters((current) => [
        ...current,
        ...next.posters.filter((poster) => !current.some((item) => item.id === poster.id)),
      ]);
      setPagination(next.pagination);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load more gallery entries.");
    } finally {
      setLoadingMore(false);
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
        error={error}
        posters={posters}
        onSelectPoster={setSelectedPoster}
        hasMore={pagination.page < pagination.totalPages}
        loadingMore={loadingMore}
        onLoadMore={() => void handleLoadMore()}
      />

      {selectedPoster ? (
        <MediaModal ariaLabel="Poster preview" onClose={() => setSelectedPoster(null)}>
          <PosterPreview
            asset={selectedPoster.imageAsset}
            draft={selectedPoster}
            showOverlay={false}
          />
          <div className="mt-3 grid max-h-[30svh] shrink-0 gap-3 overflow-y-auto overscroll-contain pr-1 sm:mt-5 sm:gap-4">
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
                  {deletingPosterId === selectedPoster.id ? "Deleting..." : "Delete Gallery Entry"}
                </Button>
              ) : null}
            </div>
          </div>
        </MediaModal>
      ) : null}
    </>
  );
}
