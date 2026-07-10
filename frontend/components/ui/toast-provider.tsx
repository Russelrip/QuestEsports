"use client";

import { useEffect } from "react";
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
    <div className="pointer-events-none fixed inset-x-3 top-20 z-[70] flex flex-col gap-3 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            className={cn(
              "toast-enter pointer-events-auto rounded-[20px] border p-4 text-left shadow-[var(--shadow-md)] sm:rounded-[24px] sm:backdrop-blur",
              toneClassName[toast.tone]
            )}
          >
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.description ? <p className="mt-1 text-xs opacity-90">{toast.description}</p> : null}
          </button>
        ))}
    </div>
  );
}
