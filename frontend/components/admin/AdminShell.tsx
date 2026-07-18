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

  return (
    <AdminGuard>
      <section className="py-8 sm:py-12">
        <Container>
          <div className="grid gap-6">
            <Card className="p-5 sm:p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <Badge className="border-purple-300/20 bg-purple-400/10 text-purple-100">Admin Dashboard</Badge>
                  <h2 className="mt-4 text-3xl text-white sm:text-4xl">{title}</h2>
                  <p className="mt-3 max-w-3xl text-sm text-slate-400">{description}</p>
                </div>
                {actions || null}
              </div>
            </Card>

            <nav className="grid gap-5 border-y border-white/10 bg-[#0d0c13]/80 px-5 py-5 md:grid-cols-2 xl:grid-cols-[0.65fr_1.6fr_1.35fr_1fr]" aria-label="Admin navigation">
              {adminNavigationGroups.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
                  <div className="flex flex-wrap gap-x-1 gap-y-1">
                    {group.links.map((link) => {
                      const isActive = pathname === link.href || (link.href !== "/admin" && pathname.startsWith(`${link.href}/`));
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

            {children}
          </div>
        </Container>
      </section>
    </AdminGuard>
  );
}
