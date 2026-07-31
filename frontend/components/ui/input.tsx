import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClassName =
  "h-12 w-full min-w-0 max-w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-purple-300/40 focus:bg-black/45 focus:ring-4 focus:ring-purple-400/10 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, onChange, disabled, ...props }, ref) {
    const [fileLabel, setFileLabel] = React.useState("");

    if (type === "file") {
      return (
        <span
          className={cn(
            "relative flex min-h-12 w-full min-w-0 max-w-full items-center gap-3 overflow-hidden border border-white/10 bg-black/30 p-1.5 text-sm transition focus-within:border-purple-300/40 focus-within:ring-4 focus-within:ring-purple-400/10",
            disabled && "cursor-not-allowed opacity-60",
            className
          )}
        >
          <input
            ref={ref}
            type="file"
            disabled={disabled}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              setFileLabel(files.length > 1 ? `${files.length} files` : files[0]?.name || "");
              onChange?.(event);
            }}
            {...props}
          />
          <span aria-hidden="true" className="inline-flex h-9 shrink-0 items-center gap-2 border border-white/10 bg-white/8 px-3 text-xs font-semibold text-slate-100">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
              <path d="M10 13V4" />
              <path d="m6.5 7.5 3.5-3.5 3.5 3.5" />
              <path d="M4 12.5v2A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-2" />
            </svg>
            Choose file
          </span>
          {fileLabel ? <span aria-hidden="true" className="min-w-0 truncate pr-2 text-xs text-slate-400">{fileLabel}</span> : null}
        </span>
      );
    }

    return <input ref={ref} type={type} disabled={disabled} onChange={onChange} className={cn(inputClassName, className)} {...props} />;
  }
);
