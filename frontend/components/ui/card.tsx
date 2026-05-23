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
        "rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,18,27,0.94),rgba(8,8,15,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur",
        className
      )}
    >
      {children}
    </div>
  );
}
