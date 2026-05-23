"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useToastStore } from "@/hooks/useToastStore";
import { cn } from "@/lib/utils";

const toneClassName = {
  success: "border-emerald-300/25 bg-emerald-400/12 text-emerald-50",
  error: "border-rose-300/25 bg-rose-400/12 text-rose-50",
  info: "border-cyan-300/25 bg-cyan-400/12 text-cyan-50",
} as const;

export function ToastProvider() {
  const { toasts, dismissToast } = useToastStore();

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }

    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), 3600)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissToast, toasts]);

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[70] flex w-full max-w-sm flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            onClick={() => dismissToast(toast.id)}
            className={cn(
              "pointer-events-auto rounded-[24px] border p-4 text-left shadow-[var(--shadow-md)] backdrop-blur",
              toneClassName[toast.tone]
            )}
          >
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.description ? <p className="mt-1 text-xs opacity-90">{toast.description}</p> : null}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
