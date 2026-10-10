"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type MenuItem = { label: string; onSelect: () => void; tone?: "default" | "danger"; disabled?: boolean; separatorBefore?: boolean };

// A small button-triggered action menu. It follows the WAI-ARIA menu button
// pattern: arrow keys move between items, Escape and outside clicks close it,
// and focus returns to the trigger.
export function Menu({ label, items, disabled, className, children }: { label: string; items: MenuItem[]; disabled?: boolean; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = React.useId();

  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("mousedown", onPointerDown);
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  const moveFocus = (step: number) => {
    const enabled = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    if (!enabled.length) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    enabled[(index + step + enabled.length) % enabled.length].focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
    else if (event.key === "Tab") close(false);
  };

  return <div ref={rootRef} className={cn("relative", className)} onKeyDown={open ? onKeyDown : undefined}>
    <button ref={triggerRef} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled} onClick={() => setOpen((value) => !value)} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-white/14 bg-white/[0.035] px-3 text-sm text-white transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60">
      {children}
    </button>
    {open ? <div id={menuId} role="menu" aria-label={label} className="absolute right-0 z-30 mt-2 min-w-48 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 p-1 shadow-2xl backdrop-blur">
      {items.map((item, index) => <React.Fragment key={item.label}>
        {item.separatorBefore ? <div role="separator" className="my-1 h-px bg-white/8" /> : null}
        <button ref={(node) => { itemRefs.current[index] = node; }} type="button" role="menuitem" disabled={item.disabled} onClick={() => { close(); item.onSelect(); }} className={cn("block w-full rounded-xl px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50", item.tone === "danger" ? "text-red-200 hover:bg-red-500/15 focus:bg-red-500/15" : "text-slate-200 hover:bg-white/8 focus:bg-white/8", "outline-none")}>{item.label}</button>
      </React.Fragment>)}
    </div> : null}
  </div>;
}
