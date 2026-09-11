"use client";
/* eslint-disable @next/next/no-img-element -- previews use in-memory object URLs. */

import { useEffect, useId, useRef, useState } from "react";

export const SUPPORT_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp";
export const SUPPORT_ATTACHMENT_MAX_COUNT = 3;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

function FilePreview({ file, index }: { file: File; index: number }) {
  const [preview] = useState<string | null>(() => typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  return preview ? <img src={preview} alt={`Screenshot ${index + 1}: ${file.name || "selected image"}`} className="aspect-square w-full object-cover" /> : <span className="flex aspect-square items-center justify-center px-2 text-center text-xs text-slate-300">{file.name || `Screenshot ${index + 1}`}</span>;
}

export default function SupportAttachmentPicker({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  const chooseFiles = (selected: File[]) => {
    const next = [...files];
    let nextError: string | null = null;
    selected.forEach((file) => {
      if (next.length >= SUPPORT_ATTACHMENT_MAX_COUNT) {
        nextError = `You can attach up to ${SUPPORT_ATTACHMENT_MAX_COUNT} screenshots.`;
      } else if (!(file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp")) {
        nextError = `${file.name || "That file"} is not a supported image. Use JPEG, PNG, or WebP.`;
      } else if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
        nextError = `${file.name || "That image"} is larger than 5 MiB.`;
      } else {
        next.push(file);
      }
    });
    setError(nextError);
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(files.filter((_, fileIndex) => fileIndex !== index));
    setError(null);
  };

  return <fieldset className="grid gap-2" disabled={disabled}>
    <legend className="text-sm font-semibold text-white">Screenshots <span className="font-normal text-slate-400">(optional)</span></legend>
    <p id={`${id}-help`} className="text-xs leading-5 text-slate-400">Up to 3 images, 5 MiB each. JPEG, PNG, or WebP.</p>
    <input ref={inputRef} id={id} type="file" accept={SUPPORT_ATTACHMENT_ACCEPT} multiple className="sr-only" aria-label="Choose screenshots" aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} onChange={(event) => { chooseFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
    <label htmlFor={id} className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-cyan-200 transition hover:bg-white/8">Add screenshots</label>
    {files.length ? <ul className="grid grid-cols-3 gap-3" aria-label="Selected screenshots">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[.04]">
        <FilePreview file={file} index={index} />
        <button type="button" className="absolute right-1 top-1 min-h-9 rounded-lg bg-slate-950/85 px-2 text-xs font-semibold text-white" aria-label={`Remove screenshot ${index + 1}`} onClick={() => remove(index)}>Remove</button>
      </li>)}</ul> : null}
    {error ? <p id={`${id}-error`} role="alert" className="text-sm text-amber-200">{error}</p> : null}
  </fieldset>;
}
