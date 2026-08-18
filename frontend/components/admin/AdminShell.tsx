"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AdminGuard from "@/components/admin/AdminGuard";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/utils";
import {
  adminNavigationGroups,
  getAdminPageHeaderContent,
  type AdminIconKey,
  type AdminNavigationLink,
} from "@/lib/admin";

const Icon = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{children}</svg>;
const adminIconPaths: Record<AdminIconKey, string> = {
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H17v15H6.5A2.5 2.5 0 0 0 4 19.5V4.5ZM4 4.5A2.5 2.5 0 0 0 1.5 2H1v15h5.5A2.5 2.5 0 0 1 9 19.5V2",
  calendar: "M4 3v3M16 3v3M2.5 8h15M4 5h12a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 16 18H4a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 4 5Z",
  clipboard: "M7 3h6v3H7V3ZM5 4H3.5v14h13V4H15M6 10h8M6 14h5",
  crosshair: "M10 2v3M10 15v3M2 10h3M15 10h3M10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  "credit-card": "M2 5.5h16v10H2v-10ZM2 9h16M5 13h3",
  dashboard: "M3 3h6v6H3V3ZM11 3h6v6h-6V3ZM3 11h6v6H3v-6ZM11 11h6v6h-6v-6Z",
  gamepad: "m5 7-2 1.5A4 4 0 0 0 5 16l1.5-2h7L15 16a4 4 0 0 0 2-7.5L15 7H5ZM6 10v3M4.5 11.5h3M13.5 11h.01M16 11h.01",
  image: "m3 4 5 5 3-3 6 6M3 4h14v12H3V4ZM6 7h.01",
  layers: "m10 3 7 4-7 4-7-4 7-4ZM3 10l7 4 7-4M3 13l7 4 7-4",
  message: "M3 4h14v12H3V4ZM3 5l7 6 7-6",
  monitor: "M3 3h14v10H3V3ZM8 17h4M10 13v4",
  package: "m10 2 7 4v8l-7 4-7-4V6l7-4ZM3 6l7 4 7-4M10 10v8",
  receipt: "M5 2h10v16l-2-1-3 1-3-1-2 1V2ZM7 6h6M7 10h6M7 14h3",
  "shopping-bag": "M4 6h12l1 11H3L4 6ZM7 6a3 3 0 0 1 6 0",
  swords: "m5 3 5 5m0 0 5-5m-5 5L5 17m5-9 5 9M3 3l2 2m12-2-2 2",
  ticket: "M3 5h14v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V5ZM10 6v8",
  trophy: "M6 3h8v4a4 4 0 0 1-8 0V3ZM4 4H2v2a3 3 0 0 0 3 3M16 4h2v2a3 3 0 0 1-3 3M10 11v4M7 18h6M8 15h4",
  "user-plus": "M12 17v-1a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v1M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 8v6M13 11h6",
  users: "M13 17v-1a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v1M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14 3.2a3 3 0 0 1 0 5.8M14 13h1a3 3 0 0 1 3 3v1",
};
const AdminNavIcon = ({ icon }: { icon: AdminIconKey }) => <Icon><path d={adminIconPaths[icon]} /></Icon>;

const AdminNavigationItem = ({
  link,
  active,
  onNavigate,
}: {
  link: AdminNavigationLink;
  active: boolean;
  onNavigate?: () => void;
}) => (
  <Link
    href={link.href}
    onClick={onNavigate}
    aria-current={active ? "page" : undefined}
    className={cn(
      "group flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white",
      active && "bg-violet-500/15 text-white shadow-[inset_3px_0_0_#a78bfa]",
    )}
  >
    <span className="flex min-w-0 items-center gap-3">
      <AdminNavIcon icon={link.icon} />
      <span className="truncate">{link.label}</span>
    </span>
    <Icon><path d="m7 4 5 6-5 6" /></Icon>
  </Link>
);

export default function AdminShell({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const hadOpenedDrawer = useRef(false);
  const isLinkActive = (href: string) => pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || user.username[0]?.toUpperCase() : "A";
  const pageHeader = getAdminPageHeaderContent(title, description);

  useEffect(() => {
    if (mobileOpen) {
      hadOpenedDrawer.current = true;
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>("a, button");
      firstFocusable?.focus();
      return;
    }

    if (hadOpenedDrawer.current) triggerRef.current?.focus();
  }, [mobileOpen]);

  const handleDrawerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setMobileOpen(false);
      return;
    }

    if (event.key !== "Tab" || !drawerRef.current) return;
    const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>("a, button"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const navigation = (onNavigate?: () => void) => (
    <nav className="grid gap-7" aria-label="Admin navigation">
      {adminNavigationGroups.map((group) => <div key={group.label}>
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{group.label}</p>
        <div className="grid gap-0.5">
          {group.links.map((link) => (
            <AdminNavigationItem
              key={link.href}
              link={link}
              active={isLinkActive(link.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>)}
    </nav>
  );

  const account = <div className="border-t border-white/10 pt-4">
    <Link href="/profile" className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.06]"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-bold text-violet-200">{initials}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{user?.username || "Admin"}</span><span className="block truncate text-xs text-slate-500">{user?.email || "Administrator"}</span></span></Link>
    <button type="button" onClick={async () => { if (await logout()) router.push("/"); }} className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-red-400/10 hover:text-red-200"><Icon><path d="M14 5H5v14h9M11 12h9m-3-3 3 3-3 3" /></Icon>Sign out</button>
  </div>;

  return <AdminGuard>
    <div data-admin-shell className="flex min-h-dvh bg-[#08070d] text-slate-200">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-white/10 bg-[#0d0c14] px-5 py-6 lg:flex">
        <Link href="/admin" className="mb-8 flex items-center gap-3 px-2"><span className="flex size-9 items-center justify-center rounded-xl bg-violet-500 font-black text-white">Q</span><span><span className="block text-sm font-bold tracking-wide text-white">QUEST ADMIN</span><span className="block text-[10px] uppercase tracking-[0.2em] text-slate-500">Operations console</span></span></Link>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{navigation()}</div>{account}
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-white/10 bg-[#0d0c14]/95 px-4 backdrop-blur-xl lg:hidden"><Link href="/admin" className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-violet-500 text-sm font-black text-white">Q</span><span className="text-sm font-bold tracking-wide text-white">QUEST ADMIN</span></Link><button ref={triggerRef} type="button" aria-label={mobileOpen ? "Close admin navigation" : "Open admin navigation"} aria-expanded={mobileOpen} aria-controls="admin-mobile-drawer" onClick={() => setMobileOpen((open) => !open)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><Icon><path d={mobileOpen ? "m5 5 10 10M15 5 5 15" : "M3 5h14M3 10h14M3 15h14"} /></Icon></button></header>
        {mobileOpen ? <div ref={drawerRef} id="admin-mobile-drawer" role="dialog" aria-modal="true" aria-label="Admin navigation" onKeyDown={handleDrawerKeyDown} className="fixed inset-x-0 bottom-0 top-16 z-20 overflow-y-auto border-b border-white/10 bg-[#0d0c14] px-4 py-6 lg:hidden">{navigation(() => setMobileOpen(false))}<div className="mt-8">{account}</div></div> : null}
        <div className="mx-auto min-w-0 max-w-[1500px] p-4 sm:p-7 xl:p-10"><div className="mb-7 flex min-w-0 flex-col gap-4 border-b border-white/10 pb-7 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><h1 className="break-words text-3xl font-bold tracking-tight text-white sm:text-4xl">{pageHeader.title}</h1><p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate-400">{pageHeader.description}</p></div>{actions ? <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{actions}</div> : null}</div><div className="grid min-w-0 gap-5">{children}</div></div>
      </div>
    </div>
  </AdminGuard>;
}
