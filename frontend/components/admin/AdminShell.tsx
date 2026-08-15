"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminGuard from "@/components/admin/AdminGuard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";
import { adminNavigationGroups } from "@/lib/admin";

export default function AdminShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLinkActive = (href: string) =>
    pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
  const navigationLinks = adminNavigationGroups.reduce<Array<{ href: string; label: string }>>(
    (links, group) => [...links, ...group.links],
    []
  );
  const activeLink = navigationLinks.find((link) => isLinkActive(link.href));

  return (
    <AdminGuard>
      <section className="overflow-x-clip py-5 sm:py-12">
        <Container>
          <div className="grid min-w-0 gap-4 sm:gap-6">
            <Card className="p-4 sm:p-8">
              <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <Badge className="border-purple-300/20 bg-purple-400/10 text-purple-100">Admin Dashboard</Badge>
                  <h2 className="mt-4 break-words text-2xl text-white sm:text-4xl">{title}</h2>
                  <p className="mt-3 max-w-3xl break-words text-sm text-slate-400">{description}</p>
                </div>
                {actions ? <div className="w-full shrink-0 [&>*]:w-full lg:w-auto lg:[&>*]:w-auto">{actions}</div> : null}
              </div>
            </Card>

            <details className="group border-y border-white/10 bg-[#0d0c13]/80 md:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Admin section</span>
                  <span className="mt-1 block truncate text-sm font-semibold text-white">{activeLink?.label || "Navigation"}</span>
                </span>
                <svg viewBox="0 0 20 20" className="size-5 shrink-0 text-slate-400 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m5 7.5 5 5 5-5" />
                </svg>
              </summary>
              <nav className="grid gap-4 border-t border-white/10 px-3 py-4" aria-label="Admin navigation">
                {adminNavigationGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {group.links.map((link) => {
                        const isActive = isLinkActive(link.href);
                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            className={cn(
                              "min-w-0 border border-transparent px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white",
                              isActive && "border-purple-300/20 bg-purple-400/10 text-white"
                            )}
                          >
                            <span className="block truncate">{link.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
            </details>

            <nav className="hidden gap-5 border-y border-white/10 bg-[#0d0c13]/80 px-5 py-5 md:grid md:grid-cols-2 xl:grid-cols-[0.65fr_1.5fr_1.15fr_0.9fr_1fr]" aria-label="Admin navigation">
              {adminNavigationGroups.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
                  <div className="flex flex-wrap gap-x-1 gap-y-1">
                    {group.links.map((link) => {
                      const isActive = isLinkActive(link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={cn(
                            "border-b-2 border-transparent px-2 py-1.5 text-sm font-medium text-slate-400 transition hover:text-white",
                            isActive && "border-purple-300 text-white"
                          )}
                        >
                          {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="grid min-w-0 gap-4 sm:gap-6">{children}</div>
          </div>
        </Container>
      </section>
    </AdminGuard>
  );
}
