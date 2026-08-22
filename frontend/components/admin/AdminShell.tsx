"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AdminGuard from "@/components/admin/AdminGuard";
import { useAuth } from "@/components/auth/AuthProvider";
import { Icon, NavIcon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  adminNavigationGroups,
  getAdminPageHeaderContent,
  type AdminNavigationLink,
} from "@/lib/admin";

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
      "group flex min-h-10 min-w-0 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white",
      active && "bg-violet-500/15 text-white shadow-[inset_3px_0_0_#a78bfa]",
    )}
  >
    <NavIcon icon={link.icon} />
    <span className="truncate">{link.label}</span>
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
    <button type="button" onClick={async () => { if (await logout()) router.push("/"); }} className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-red-400/10 hover:text-red-200"><NavIcon icon="logout" />Sign out</button>
  </div>;

  return <AdminGuard>
    <div data-admin-shell className="flex min-h-dvh bg-[#08070d] text-slate-200">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-white/10 bg-[#0d0c14] px-5 py-6 lg:flex">
        <Link href="/admin" className="mb-8 flex items-center gap-3 px-2"><span className="flex size-9 items-center justify-center rounded-xl bg-violet-500 font-black text-white">Q</span><span className="text-sm font-bold tracking-wide text-white">QUEST ADMIN</span></Link>
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
