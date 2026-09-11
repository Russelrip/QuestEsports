"use client";
/* eslint-disable @next/next/no-img-element -- private authenticated content URLs are not Next image sources. */

import { useState } from "react";
import type { SupportAttachment } from "@/lib/support";
import { buildPublicApiUrl } from "@/lib/api";

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function Attachment({ attachment }: { attachment: SupportAttachment }) {
  const [unavailable, setUnavailable] = useState(false);
  const contentUrl = buildPublicApiUrl(attachment.contentUrl);
  if (unavailable) return <span role="status" className="flex min-h-20 items-center rounded-xl border border-white/10 px-3 text-xs text-slate-400">Attachment {attachment.position + 1} unavailable</span>;
  return <a href={contentUrl} className="block overflow-hidden rounded-xl border border-white/10 bg-black/15 transition hover:border-cyan-200/60" aria-label={`Open attachment ${attachment.position + 1}`}>
    <img src={contentUrl} alt={`Attachment ${attachment.position + 1}`} className="aspect-square w-28 object-cover" onError={() => setUnavailable(true)} />
    <span className="block px-2 py-1.5 text-[11px] text-slate-400">{attachment.contentType.replace("image/", "").toUpperCase()} · {formatBytes(attachment.byteSize)}</span>
  </a>;
}

export default function SupportAttachments({ attachments }: { attachments?: SupportAttachment[] }) {
  if (!attachments?.length) return null;
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">{attachments.map((attachment) => <Attachment key={attachment.id} attachment={attachment} />)}</div>;
}
