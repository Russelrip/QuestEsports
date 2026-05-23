"use client";

import { AnimatePresence, motion } from "framer-motion";

type MediaModalProps = {
  onClose: () => void;
  children: React.ReactNode;
};

export default function MediaModal({ onClose, children }: MediaModalProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(3,2,9,0.92)] p-4 backdrop-blur"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          className="relative max-h-[92vh] w-full max-w-5xl overflow-auto rounded-[32px] border border-white/10 bg-[var(--color-card-strong)] p-6 shadow-[var(--shadow-lg)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xl text-white"
            onClick={onClose}
          >
            ×
          </button>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
