"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import MediaModal from "@/components/posters/MediaModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToastStore } from "@/hooks/useToastStore";
import { apiFetch } from "@/lib/auth";
import {
  fetchImages,
  fetchPublicUploadFiles,
  applyLegacyImageFallback,
  resolveImageAssetUrl,
  resolveImageUrl,
  type ImageAsset,
  type MediaPagination,
  type PublicUploadFile,
} from "@/lib/media";
import {
  buildUploadPreviews,
  revokeUploadPreviews,
  uploadImages,
  type UploadPreview,
} from "@/lib/poster-studio";
import { parseApiResponse } from "@/lib/api";

const categories = ["poster", "photo", "logo", "banner", "graphic"] as const;
type MediaCategory = (typeof categories)[number];

const emptyPagination: MediaPagination = {
  page: 1,
  pageSize: 24,
  total: 0,
  totalPages: 1,
};

const formatBytes = (value?: number | null) => {
  if (value === undefined || value === null || value < 0) return "Size unavailable";
  if (value === 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const safeDownloadName = (asset: ImageAsset) => {
  const extensionByContentType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const originalName = asset.originalName?.trim();
  const fallback = `${asset.title}${extensionByContentType[asset.contentType] || ""}`;
  return (originalName || fallback).replace(/[\\/:*?"<>|]+/g, "-");
};

export default function AdminMediaManager() {
  const showToast = useToastStore((state) => state.showToast);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selected, setSelected] = useState<ImageAsset | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadCategory, setUploadCategory] = useState<MediaCategory>("graphic");
  const [uploadPreviews, setUploadPreviews] = useState<UploadPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [storageFiles, setStorageFiles] = useState<PublicUploadFile[]>([]);
  const [storageTotalBytes, setStorageTotalBytes] = useState(0);
  const [storagePagination, setStoragePagination] = useState(emptyPagination);
  const [storagePage, setStoragePage] = useState(1);
  const [storageDirectory, setStorageDirectory] = useState("");
  const [storageDirectories, setStorageDirectories] = useState<string[]>([]);
  const [storageLoading, setStorageLoading] = useState(true);
  const [selectedStorageFile, setSelectedStorageFile] = useState<PublicUploadFile | null>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setImageError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "24" });
    if (search) params.set("search", search);
    if (category) params.set("category", category);

    try {
      const result = await fetchImages(params);
      setImages(result.images);
      setPagination(result.pagination);
    } catch (nextError) {
      setImageError(nextError instanceof Error ? nextError.message : "Unable to load the media library.");
    } finally {
      setLoading(false);
    }
  }, [category, page, search]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const loadStorageFiles = useCallback(async () => {
    setStorageLoading(true);
    setStorageError("");
    const params = new URLSearchParams({ page: String(storagePage), pageSize: "24" });
    if (search) params.set("search", search);
    if (storageDirectory) params.set("directory", storageDirectory);
    try {
      const result = await fetchPublicUploadFiles(params);
      setStorageFiles(result.files);
      setStorageDirectories(result.directories);
      setStorageTotalBytes(result.totalBytes);
      setStoragePagination(result.pagination);
    } catch (nextError) {
      setStorageError(nextError instanceof Error ? nextError.message : "Unable to load public upload folders.");
    } finally {
      setStorageLoading(false);
    }
  }, [search, storageDirectory, storagePage]);

  useEffect(() => {
    void loadStorageFiles();
  }, [loadStorageFiles]);

  useEffect(
    () => () => {
      revokeUploadPreviews(uploadPreviews);
    },
    [uploadPreviews],
  );

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setStoragePage(1);
    setSearch(searchInput.trim());
  };

  const selectFiles = (files: File[]) => {
    setUploadPreviews((current) => {
      revokeUploadPreviews(current);
      return buildUploadPreviews(files);
    });
  };

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploadPreviews.length === 0) return;
    setUploading(true);
    setActionError("");

    try {
      const title =
        uploadTitle.trim() || uploadPreviews[0].file.name.replace(/\.[^.]+$/, "") || "Media file";
      const uploaded = await uploadImages({
        title,
        description: uploadDescription.trim(),
        category: uploadCategory,
        previews: uploadPreviews,
      });
      setUploadTitle("");
      setUploadDescription("");
      setUploadPreviews((current) => {
        revokeUploadPreviews(current);
        return [];
      });
      setPage(1);
      setStoragePage(1);
      await Promise.all([loadImages(), loadStorageFiles()]);
      showToast({
        tone: "success",
        title: "Media uploaded",
        description: `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} added to the library.`,
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to upload media.";
      setActionError(message);
      showToast({ tone: "error", title: "Upload failed", description: message });
    } finally {
      setUploading(false);
    }
  };

  const downloadImage = async (asset: ImageAsset) => {
    setDownloadingId(asset.id);
    try {
      const response = await apiFetch(`/api/images/${asset.id}/binary`, { timeoutMs: 30_000 });
      if (!response.ok) {
        await parseApiResponse(response, "Unable to download image.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = safeDownloadName(asset);
        link.click();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Download failed",
        description: nextError instanceof Error ? nextError.message : "Unable to download image.",
      });
    } finally {
      setDownloadingId("");
    }
  };

  const downloadStorageFile = async (file: PublicUploadFile) => {
    const key = `${file.directory}/${file.filename}`;
    setDownloadingId(key);
    try {
      const response = await apiFetch(file.imageUrl, { timeoutMs: 30_000 });
      if (!response.ok) {
        await parseApiResponse(response, "Unable to download file.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = file.filename;
        link.click();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Download failed",
        description: nextError instanceof Error ? nextError.message : "Unable to download file.",
      });
    } finally {
      setDownloadingId("");
    }
  };

  const copyImageUrl = async (asset: ImageAsset) => {
    try {
      const url = new URL(resolveImageAssetUrl(asset), window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      showToast({ tone: "success", title: "Image URL copied" });
    } catch {
      showToast({ tone: "error", title: "Unable to copy image URL" });
    }
  };

  const copyStorageUrl = async (file: PublicUploadFile) => {
    try {
      const url = new URL(resolveImageUrl(file.imageUrl) || window.location.origin, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      showToast({ tone: "success", title: "File URL copied" });
    } catch {
      showToast({ tone: "error", title: "Unable to copy file URL" });
    }
  };

  const deleteImage = async (asset: ImageAsset) => {
    if (asset.canDelete === false) return;
    if (!window.confirm(`Delete "${asset.title}" permanently? This cannot be undone.`)) return;
    setDeletingId(asset.id);
    try {
      const response = await apiFetch(`/api/images/${asset.id}`, { method: "DELETE" });
      await parseApiResponse(response, "Unable to delete image.");
      setSelected((current) => (current?.id === asset.id ? null : current));
      if (images.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        await loadImages();
      }
      showToast({ tone: "success", title: "Image deleted" });
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Delete failed",
        description: nextError instanceof Error ? nextError.message : "Unable to delete image.",
      });
    } finally {
      setDeletingId("");
    }
  };

  return (
    <AdminShell
      title="Media Library"
      description="Browse, upload, preview, download, and safely remove public image assets. Private payment evidence is never shown here."
    >
      <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <Card className="h-fit p-5 sm:p-7">
          <h3 className="text-2xl text-white">Upload Files</h3>
          <p className="mt-2 text-sm text-slate-400">PNG, JPG, or WebP. Up to 10 files and 10 MB per file.</p>
          <form className="mt-6 grid gap-4" onSubmit={submitUpload}>
            <FormField label="Title" hint="When uploading several files, a number is added automatically.">
              <Input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Defaults to the first filename" />
            </FormField>
            <FormField label="Description">
              <Textarea value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value)} rows={3} />
            </FormField>
            <FormField label="Category" required>
              <Select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value as MediaCategory)}>
                {categories.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
              </Select>
            </FormField>
            <FormField label="Images" required>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => selectFiles(Array.from(event.target.files || []))}
              />
            </FormField>
            {uploadPreviews.length ? (
              <div className="grid grid-cols-3 gap-2">
                {uploadPreviews.slice(0, 6).map((item) => (
                  <Image key={`${item.file.name}-${item.file.size}`} src={item.previewUrl} alt={item.file.name} width={400} height={400} unoptimized className="aspect-square w-full border border-white/10 object-cover" />
                ))}
              </div>
            ) : null}
            <Button type="submit" disabled={uploading || uploadPreviews.length === 0}>
              {uploading ? "Uploading..." : `Upload${uploadPreviews.length > 1 ? ` ${uploadPreviews.length} files` : ""}`}
            </Button>
          </form>
        </Card>

        <div className="grid min-w-0 gap-4">
          <Card className="p-4 sm:p-5">
            <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]" onSubmit={submitSearch}>
              <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search title, description, or filename" aria-label="Search media" />
              <Select
                value={category}
                aria-label="Filter by category"
                onChange={(event) => {
                  setCategory(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {categories.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
              </Select>
              <Button type="submit">Search</Button>
            </form>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <span>{pagination.total} file{pagination.total === 1 ? "" : "s"}</span>
              {(search || category) ? (
                <button
                  type="button"
                  className="text-purple-200 hover:text-white"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setCategory("");
                    setPage(1);
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </Card>

          {actionError || imageError ? <p className="border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{actionError || imageError}</p> : null}

          {loading ? (
            <Card className="p-10 text-center text-sm text-slate-400">Loading media...</Card>
          ) : images.length === 0 ? (
            <EmptyState title="No media found" description="Upload an image or clear the current filters." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {images.map((asset) => {
                const usageCount = (asset.usage?.posters || 0) + (asset.usage?.products || 0);
                return (
                  <Card key={asset.id} className="overflow-hidden">
                    <button type="button" className="relative block aspect-[4/3] w-full bg-black/30" onClick={() => setSelected(asset)}>
                      <Image src={resolveImageAssetUrl(asset) || "/images/logo.png"} alt={asset.title} width={800} height={600} unoptimized className="h-full w-full object-contain" onError={(event) => { if (!applyLegacyImageFallback(event.currentTarget, asset)) event.currentTarget.style.display = "none"; }} />
                    </button>
                    <div className="grid gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white" title={asset.title}>{asset.title}</p>
                        <p className="mt-1 truncate text-xs text-slate-500" title={asset.originalName || undefined}>{asset.originalName || "No original filename"}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.12em] text-slate-400">
                        <span className="border border-white/10 px-2 py-1">{asset.category}</span>
                        <span className="border border-white/10 px-2 py-1">{formatBytes(asset.byteSize)}</span>
                        <span className="border border-white/10 px-2 py-1">{usageCount ? `Used ${usageCount}` : "Unused"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void downloadImage(asset)} disabled={downloadingId === asset.id}>
                          {downloadingId === asset.id ? "Downloading..." : "Download"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void copyImageUrl(asset)}>Copy URL</Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelected(asset)}>Details</Button>
                        <Button size="sm" variant="danger" onClick={() => void deleteImage(asset)} disabled={asset.canDelete === false || deletingId === asset.id} title={asset.canDelete === false ? "Remove the poster or product reference first." : undefined}>
                          {deletingId === asset.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <span className="text-sm text-slate-400">Page {pagination.page} of {pagination.totalPages}</span>
              <Button variant="secondary" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </div>
          ) : null}

          <Card className="mt-4 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">Public Storage</p>
                <h3 className="mt-2 text-xl text-white">Upload Folders</h3>
                <p className="mt-1 text-sm text-slate-400">Tournament artwork, gallery files, game assets, team logos, avatars, and sponsor logos. Manage deletion from the feature that owns each file.</p>
              </div>
              <Select
                className="sm:w-56"
                value={storageDirectory}
                aria-label="Choose upload folder"
                onChange={(event) => {
                  setStorageDirectory(event.target.value);
                  setStoragePage(1);
                }}
              >
                <option value="">All public folders</option>
                {storageDirectories.map((directory) => <option key={directory} value={directory}>{directory}</option>)}
              </Select>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              {storagePagination.total} file{storagePagination.total === 1 ? "" : "s"} · {formatBytes(storageTotalBytes)} used{search ? ` matching “${search}”` : ""}
            </p>
          </Card>

          {storageError ? <p className="border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{storageError}</p> : null}

          {storageLoading ? (
            <Card className="p-8 text-center text-sm text-slate-400">Loading upload folders...</Card>
          ) : storageFiles.length === 0 ? (
            <EmptyState title="No stored files found" description="This folder may be empty in the current environment." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {storageFiles.map((file) => {
                const key = `${file.directory}/${file.filename}`;
                return (
                  <Card key={key} className="overflow-hidden">
                    <button type="button" className="block aspect-[4/3] w-full bg-black/30" onClick={() => setSelectedStorageFile(file)}>
                      <Image src={resolveImageUrl(file.imageUrl) || "/images/logo.png"} alt={file.filename} width={800} height={600} unoptimized className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                    </button>
                    <div className="grid gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white" title={file.filename}>{file.filename}</p>
                        <p className="mt-1 text-xs text-slate-500">{file.directory} · {formatBytes(file.byteSize)}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" disabled={downloadingId === key} onClick={() => void downloadStorageFile(file)}>
                          {downloadingId === key ? "Downloading..." : "Download"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void copyStorageUrl(file)}>Copy URL</Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {storagePagination.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" disabled={storagePage <= 1 || storageLoading} onClick={() => setStoragePage((current) => Math.max(1, current - 1))}>Previous</Button>
              <span className="text-sm text-slate-400">Storage page {storagePagination.page} of {storagePagination.totalPages}</span>
              <Button variant="secondary" disabled={storagePage >= storagePagination.totalPages || storageLoading} onClick={() => setStoragePage((current) => current + 1)}>Next</Button>
            </div>
          ) : null}
        </div>
      </div>

      {selected ? (
        <MediaModal ariaLabel="Image details" onClose={() => setSelected(null)}>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/35 p-2 sm:p-6">
            <Image src={resolveImageAssetUrl(selected) || "/images/logo.png"} alt={selected.title} width={1600} height={1200} unoptimized className="max-h-full max-w-full object-contain" onError={(event) => { if (!applyLegacyImageFallback(event.currentTarget, selected)) event.currentTarget.style.display = "none"; }} />
          </div>
          <div className="grid shrink-0 gap-3 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="min-w-0">
              <h3 className="truncate text-xl text-white">{selected.title}</h3>
              <p className="mt-1 break-all text-xs text-slate-500">{selected.originalName || selected.id}</p>
              <p className="mt-2 text-sm text-slate-400">
                {selected.category} · {formatBytes(selected.byteSize)} · Added {new Date(selected.createdAt).toLocaleDateString()}
              </p>
              {selected.description ? <p className="mt-2 text-sm text-slate-300">{selected.description}</p> : null}
              {selected.canDelete === false ? <p className="mt-2 text-xs text-amber-200">In use by {selected.usage?.posters || 0} gallery entries and {selected.usage?.products || 0} products. Remove those references before deleting.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void downloadImage(selected)}>Download</Button>
              <Button variant="ghost" onClick={() => void copyImageUrl(selected)}>Copy URL</Button>
              <Button variant="danger" disabled={selected.canDelete === false} onClick={() => void deleteImage(selected)}>Delete</Button>
            </div>
          </div>
        </MediaModal>
      ) : null}

      {selectedStorageFile ? (
        <MediaModal ariaLabel="Stored file preview" onClose={() => setSelectedStorageFile(null)}>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/35 p-2 sm:p-6">
            <Image src={resolveImageUrl(selectedStorageFile.imageUrl) || "/images/logo.png"} alt={selectedStorageFile.filename} width={1600} height={1200} unoptimized className="max-h-full max-w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          </div>
          <div className="flex shrink-0 flex-col gap-3 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h3 className="break-all text-xl text-white">{selectedStorageFile.filename}</h3>
              <p className="mt-2 text-sm text-slate-400">{selectedStorageFile.directory} · {formatBytes(selectedStorageFile.byteSize)} · Modified {new Date(selectedStorageFile.modifiedAt).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void downloadStorageFile(selectedStorageFile)}>Download</Button>
              <Button variant="ghost" onClick={() => void copyStorageUrl(selectedStorageFile)}>Copy URL</Button>
            </div>
          </div>
        </MediaModal>
      ) : null}
    </AdminShell>
  );
}
