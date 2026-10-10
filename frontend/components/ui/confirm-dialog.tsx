"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

// A modal confirmation for destructive actions. Focus starts on Cancel so a
// stray Enter never confirms, and Escape or the backdrop dismisses it.
export function ConfirmDialog({ open, title, description, confirmLabel, busy, onConfirm, onCancel }: { open: boolean; title: string; description: React.ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
      <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
      <div id={descriptionId} className="mt-3 text-sm leading-6 text-slate-400">{description}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button ref={cancelRef} variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</Button>
      </div>
    </div>
  </div>;
}
