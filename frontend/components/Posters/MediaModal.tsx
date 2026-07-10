"use client";

import { useEffect } from "react";

type MediaModalProps = {
  onClose: () => void;
  children: React.ReactNode;
};

export default function MediaModal({ onClose, children }: MediaModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,2,9,0.96)] p-2 sm:p-4 sm:backdrop-blur"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Poster preview"
        className="modal-panel-enter relative flex h-[96svh] max-h-[56rem] w-full max-w-5xl flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[var(--color-card-strong)] p-3 shadow-[var(--shadow-lg)] sm:h-[92svh] sm:rounded-[32px] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close preview"
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/75 text-xl text-white shadow-lg sm:right-4 sm:top-4"
          onClick={onClose}
        >
          &times;
        </button>
        {children}
      </div>
    </div>
  );
}
