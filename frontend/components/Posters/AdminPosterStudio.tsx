"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { ImageAsset } from "@/lib/media";
import { UploadPreview } from "@/lib/poster-studio";
import { resolveMediaUrl } from "@/lib/media";

type PosterDraftValues = {
  title: string;
  imageAssetId: string;
};

type AdminPosterStudioProps = {
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
}: AdminPosterStudioProps) {
  return (
    <section className="admin-section">
      <div className="container admin-dashboard">
        <div className="admin-header">
          <div>
            <span className="profile-badge">Media Studio</span>
            <h2>Upload images and build posters</h2>
            <p className="section-intro admin-section-intro">
              Upload poster artwork to the backend media library, then save it to the public
              poster gallery.
            </p>
          </div>
        </div>

        <div className="media-studio-grid">
          <form className="admin-users-card media-panel" onSubmit={onUploadSubmit}>
            <div className="admin-users-head">
              <div>
                <h3>Upload Images</h3>
                <p>Choose one or more PNG or JPG files and add them to the poster media library.</p>
              </div>
            </div>

            <div className="admin-form-grid">
              <div className="form-group">
                <label htmlFor="uploadTitle">Optional title</label>
                <input
                  id="uploadTitle"
                  value={uploadTitle}
                  onChange={(event) => onUploadTitleChange(event.target.value)}
                  placeholder="Leave blank to use the file name"
                />
              </div>
              <div className="form-group admin-form-full">
                <label htmlFor="uploadImages">Images</label>
                <input
                  id="uploadImages"
                  type="file"
                  accept="image/png,image/jpeg"
                  multiple
                  onChange={onFileSelection}
                  required
                />
              </div>
            </div>

            {uploadPreviews.length > 0 ? (
              <div className="media-preview-grid">
                {uploadPreviews.map((item) => (
                  <div key={`${item.file.name}-${item.file.size}`} className="media-preview-card">
                    <img src={item.previewUrl} alt={item.file.name} />
                    <p>{item.file.name}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="media-empty-preview">
                <strong>No images selected yet</strong>
                <p>Choose one or more PNG or JPG files to preview them here before upload.</p>
              </div>
            )}

            {error ? <p className="error-message">{error}</p> : null}
            {uploadSuccess ? <p className="success-inline">{uploadSuccess}</p> : null}
            <button type="submit" className="btn btn-primary" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload image"}
            </button>
          </form>

          <form className="admin-users-card media-panel" onSubmit={onPosterSubmit}>
            <div className="admin-users-head">
              <div>
                <h3>Create Poster</h3>
                <p>Select an uploaded image, name the poster, preview it, and save.</p>
              </div>
            </div>

            <div className="admin-form-grid">
              <div className="form-group">
                <label htmlFor="posterTitle">Poster title</label>
                <input
                  id="posterTitle"
                  value={posterDraft.title}
                  onChange={(event) => onPosterDraftChange({ title: event.target.value })}
                  placeholder="Open Finals poster"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="posterImage">Source image</label>
                <select
                  id="posterImage"
                  value={posterDraft.imageAssetId}
                  onChange={(event) =>
                    onPosterDraftChange({ imageAssetId: event.target.value })
                  }
                  required
                >
                  <option value="">Select an uploaded image</option>
                  {images.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.title} ({image.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedDraftAsset ? (
              <div className="poster-preview">
                <img
                  src={resolveMediaUrl(selectedDraftAsset.imageUrl)}
                  alt={selectedDraftAsset.title}
                />
              </div>
            ) : (
              <EmptyState description="Upload or select an image to preview the poster." />
            )}

            {error ? <p className="error-message">{error}</p> : null}
            {posterSuccess ? <p className="success-inline">{posterSuccess}</p> : null}
            <button type="submit" className="btn btn-primary" disabled={posterSaving}>
              {posterSaving ? "Saving..." : "Save poster entry"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
