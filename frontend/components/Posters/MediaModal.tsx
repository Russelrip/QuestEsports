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
        className="modal-backdrop-enter fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,2,9,0.96)] p-3 sm:p-4 sm:backdrop-blur"
        onClick={onClose}
      >
        <div
          className="modal-panel-enter relative max-h-[92svh] w-full max-w-5xl overflow-auto overscroll-contain rounded-[24px] border border-white/10 bg-[var(--color-card-strong)] p-4 shadow-[var(--shadow-lg)] sm:rounded-[32px] sm:p-6"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Close preview"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xl text-white"
            onClick={onClose}
          >
            &times;
          </button>
          {children}
        </div>
      </div>
  );
}
