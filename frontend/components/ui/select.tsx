import * as React from "react";
import { cn } from "@/lib/utils";

const selectClassName =
  "h-12 w-full min-w-0 max-w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-purple-300/40 focus:bg-black/45 focus:ring-4 focus:ring-purple-400/10 disabled:cursor-not-allowed disabled:opacity-60";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(selectClassName, className)} {...props} />;
  }
);
