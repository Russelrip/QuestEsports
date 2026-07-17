"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/auth";
import { getInitials } from "@/lib/utils";
import { buildApiUrl } from "@/lib/api";

type UserMenuProps = {
  user: AuthUser;
  logout: () => Promise<boolean>;
  isAdmin?: boolean;
};

export default function UserMenu({ user, logout, isAdmin = false }: UserMenuProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const initials = getInitials(user.firstName, user.lastName, user.username);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
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
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className={`account-menu-trigger flex items-center gap-3 border px-3 py-2 text-left transition ${isOpen ? "border-white/10 bg-white/6" : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/6"}`}
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <span className="account-menu-avatar flex size-9 items-center justify-center overflow-hidden bg-violet-700 text-xs font-bold text-white">
          {user.avatarUrl ? <Image src={buildApiUrl(user.avatarUrl)} alt="" width={36} height={36} className="h-full w-full object-cover" /> : initials}
        </span>
        <span>
          <span className="block text-sm font-semibold text-white">{user.username}</span>
          <span className="block text-xs text-slate-400">
            {user.emailVerified ? "Verified account" : "Verification pending"}
          </span>
        </span>
      </button>

      {isOpen ? (
          <div className="account-menu-panel popover-enter absolute right-0 top-[calc(100%+0.75rem)] z-20 w-72 border border-white/10 bg-[rgba(12,12,20,0.98)] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
            <div className="mb-4 space-y-2 border-b border-white/8 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </div>
                <Badge className="account-menu-badge border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
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
