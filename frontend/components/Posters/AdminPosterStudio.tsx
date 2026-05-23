"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { resolveMediaUrl, type ImageAsset } from "@/lib/media";
import { type UploadPreview } from "@/lib/poster-studio";

type PosterDraftValues = {
  title: string;
  imageAssetId: string;
};

export default function AdminPosterStudio({
  images,
  uploadTitle,
  uploadPreviews,
  uploading,
  uploadSuccess,
  posterDraft,
  posterSaving,
  posterSuccess,
  selectedDraftAsset,
  error,
  onUploadTitleChange,
  onFileSelection,
  onUploadSubmit,
  onPosterDraftChange,
  onPosterSubmit,
}: {
  images: ImageAsset[];
  uploadTitle: string;
  uploadPreviews: UploadPreview[];
  uploading: boolean;
  uploadSuccess: string;
  posterDraft: PosterDraftValues;
  posterSaving: boolean;
  posterSuccess: string;
  selectedDraftAsset: ImageAsset | null;
  error: string;
  onUploadTitleChange: (value: string) => void;
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPosterDraftChange: (updates: Partial<PosterDraftValues>) => void;
  onPosterSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="pt-6">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Media Studio</p>
          <h2 className="mt-3 text-3xl text-white">Upload images and build posters</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Upload poster artwork to the backend media library, then save it to the public poster gallery.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="p-6 sm:p-8">
            <form className="grid gap-5" onSubmit={onUploadSubmit}>
              <div>
                <h3 className="text-2xl text-white">Upload Images</h3>
                <p className="mt-2 text-sm text-slate-400">Choose one or more PNG or JPG files and add them to the poster media library.</p>
              </div>
              <FormField label="Optional title" htmlFor="uploadTitle">
                <Input id="uploadTitle" value={uploadTitle} onChange={(event) => onUploadTitleChange(event.target.value)} placeholder="Leave blank to use the file name" />
              </FormField>
              <FormField label="Images" htmlFor="uploadImages">
                <Input id="uploadImages" type="file" accept="image/png,image/jpeg" multiple onChange={onFileSelection} required />
              </FormField>

              {uploadPreviews.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {uploadPreviews.map((item) => (
                    <div key={`${item.file.name}-${item.file.size}`} className="rounded-[20px] border border-white/8 bg-white/5 p-3">
                      <img src={item.previewUrl} alt={item.file.name} className="aspect-square w-full rounded-[16px] object-cover" />
                      <p className="mt-3 text-sm text-slate-300">{item.file.name}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState description="Choose one or more PNG or JPG files to preview them here before upload." />
              )}

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
              {uploadSuccess ? <p className="text-sm text-emerald-300">{uploadSuccess}</p> : null}
              <Button type="submit" disabled={uploading}>{uploading ? "Uploading..." : "Upload image"}</Button>
            </form>
          </Card>

          <Card className="p-6 sm:p-8">
            <form className="grid gap-5" onSubmit={onPosterSubmit}>
              <div>
                <h3 className="text-2xl text-white">Create Poster</h3>
                <p className="mt-2 text-sm text-slate-400">Select an uploaded image, name the poster, preview it, and save.</p>
              </div>
              <FormField label="Poster title" htmlFor="posterTitle">
                <Input id="posterTitle" value={posterDraft.title} onChange={(event) => onPosterDraftChange({ title: event.target.value })} placeholder="Open Finals poster" required />
              </FormField>
              <FormField label="Source image" htmlFor="posterImage">
                <Select id="posterImage" value={posterDraft.imageAssetId} onChange={(event) => onPosterDraftChange({ imageAssetId: event.target.value })} required>
                  <option value="">Select an uploaded image</option>
                  {images.map((image) => (
                    <option key={image.id} value={image.id}>{image.title} ({image.category})</option>
                  ))}
                </Select>
              </FormField>

              {selectedDraftAsset ? (
                <div className="overflow-hidden rounded-[24px] border border-white/8 bg-white/5 p-3">
                  <img src={resolveMediaUrl(selectedDraftAsset.imageUrl)} alt={selectedDraftAsset.title} className="w-full rounded-[18px] object-cover" />
                </div>
              ) : (
                <EmptyState description="Upload or select an image to preview the poster." />
              )}

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
              {posterSuccess ? <p className="text-sm text-emerald-300">{posterSuccess}</p> : null}
              <Button type="submit" disabled={posterSaving}>{posterSaving ? "Saving..." : "Save poster entry"}</Button>
            </form>
          </Card>
        </div>
      </div>
    </section>
  );
}
