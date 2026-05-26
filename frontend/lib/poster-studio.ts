import { parseApiResponse } from "@/lib/api";
import { apiFetch } from "@/lib/auth";
import { ImageAsset, Poster, resolveMediaUrl } from "@/lib/media";

export type UploadPreview = {
  file: File;
  previewUrl: string;
};

export type PosterDraft = {
  title: string;
  imageAssetId: string;
};

export const initialPosterDraft: PosterDraft = {
  title: "",
  imageAssetId: "",
};

export const formatMediaDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

export const revokeUploadPreviews = (previews: UploadPreview[]) => {
  previews.forEach((item) => {
    URL.revokeObjectURL(item.previewUrl);
  });
};

export const buildUploadPreviews = (files: File[]) =>
  files.map((file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
  }));

export const uploadImages = async (input: {
  title: string;
  previews: UploadPreview[];
}) => {
  const formData = new FormData();
  formData.append("title", input.title);
  formData.append("category", "poster");

  input.previews.forEach((item) => {
    formData.append("images", item.file);
  });

  const response = await apiFetch("/api/images", {
    method: "POST",
    body: formData,
  });
  const data = await parseApiResponse<{ images?: ImageAsset[] }>(
    response,
    "Unable to upload images."
  );

  const images = data.images || [];
  if (images.length === 0) {
    throw new Error("Upload succeeded but no image assets were returned.");
  }

  return images;
};

export const savePoster = async (draft: PosterDraft) => {
  const payload = {
    imageAssetId: draft.imageAssetId,
    title: draft.title,
    description: "",
    category: "poster",
    headline: draft.title,
    subheadline: "",
    accentColor: "#7c3aed",
    textColor: "#ffffff",
    overlayAlign: "bottom-left" as const,
  };

  const response = await apiFetch("/api/posters", {
    method: "POST",
    json: payload,
  });
  const data = await parseApiResponse<{ poster?: Poster }>(
    response,
    "Unable to create poster."
  );

  if (!data.poster) {
    throw new Error("Poster response was missing the saved poster entry.");
  }

  return data.poster;
};

export const deletePoster = async (posterId: string) => {
  const response = await apiFetch(`/api/posters/${posterId}`, {
    method: "DELETE",
  });
  await parseApiResponse(response, "Unable to delete poster.");
};

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image for export."));
    image.src = src;
  });

export const exportPosterPng = async (
  asset: ImageAsset,
  draft: {
    title: string;
    headline: string;
  }
) => {
  const response = await fetch(resolveMediaUrl(asset.imageUrl), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Unable to fetch poster image for export.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadImageElement(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 1200;
    canvas.height = image.naturalHeight || 1600;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas export is not supported in this browser.");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `${draft.title || draft.headline || "quest-poster"}.png`
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-");
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
