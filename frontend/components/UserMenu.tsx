"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/auth";
import { getInitials } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/media";
import NotificationBell from "@/components/notifications/NotificationBell";

type UserMenuProps = {
  user: AuthUser;
  logout: () => Promise<boolean>;
  isAdmin?: boolean;
};

export default function UserMenu({ user, logout, isAdmin = false }: UserMenuProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const initials = getInitials(user.firstName, user.lastName, user.username);
  const avatarUrl = resolveImageUrl(user.avatarUrl);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setNotificationsOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        setNotificationsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div className="relative flex items-center gap-3" ref={menuRef}>
      <NotificationBell
        user={user}
        alignToAccount
        open={notificationsOpen}
        onOpenChange={(nextOpen) => {
          setNotificationsOpen(nextOpen);
          if (nextOpen) setIsOpen(false);
        }}
      />
      <button
        type="button"
        className={`account-menu-trigger flex items-center gap-3 border px-3 py-2 text-left transition ${isOpen ? "border-white/10 bg-white/6" : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/6"}`}
        onClick={() => {
          setNotificationsOpen(false);
          setIsOpen((current) => !current);
        }}
        aria-expanded={isOpen}
      >
        <span className="account-menu-avatar relative flex size-9 items-center justify-center overflow-hidden bg-violet-700 text-xs font-bold text-white">
          <span aria-hidden="true">{initials}</span>{avatarUrl ? <Image src={avatarUrl} alt="" width={36} height={36} unoptimized className="absolute h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
        </span>
        <span>
          <span className="block text-sm font-semibold text-white">{user.username}</span>
          <span className="block text-xs text-slate-400">
            {user.emailVerified ? "Verified account" : "Verification pending"}
          </span>
        </span>
      </button>

      {isOpen ? (
          <div className="account-menu-panel popover-enter absolute right-0 top-[calc(100%+0.75rem)] z-20 w-[min(18rem,calc(100vw-2rem))] border border-white/10 bg-[rgba(12,12,20,0.98)] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
            <div className="mb-4 space-y-2 border-b border-white/8 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </div>
                <Badge className="account-menu-badge border-purple-300/20 bg-purple-400/10 text-purple-100">
                  {user.role}
                </Badge>
              </div>
            </div>

            <div className="grid gap-2">
              <Link href="/profile" className="account-menu-item px-3 py-2 text-sm text-slate-200 transition hover:bg-white/8 hover:text-white">
                Profile
              </Link>
              {isAdmin ? (
                <Link href="/admin" className="account-menu-item px-3 py-2 text-sm text-slate-200 transition hover:bg-white/8 hover:text-white">
                  Admin Panel
                </Link>
              ) : null}
              <Button
                variant="secondary"
                className="account-menu-action w-full"
                onClick={async () => {
                  if (await logout()) router.push("/");
                }}
              >
                Logout
              </Button>
            </div>
          </div>
      ) : null}
    </div>
  );
}
