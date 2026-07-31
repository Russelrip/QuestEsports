import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "min-w-0 rounded-none border border-white/10 bg-[#0d0c13] shadow-[0_12px_32px_rgba(0,0,0,0.28)] sm:shadow-[0_24px_80px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </div>
  );
}
