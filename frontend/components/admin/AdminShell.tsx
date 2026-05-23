"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminGuard from "@/components/admin/AdminGuard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";
import { adminNavigationLinks } from "@/lib/admin";

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
            <Card className="p-6 sm:p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">Admin Dashboard</Badge>
                  <h2 className="mt-4 text-3xl text-white sm:text-4xl">{title}</h2>
                  <p className="mt-3 max-w-3xl text-sm text-slate-400">{description}</p>
                </div>
                {actions || null}
              </div>
            </Card>

            <Card className="p-3">
              <nav className="flex flex-wrap gap-2" aria-label="Admin navigation">
                {adminNavigationLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/8 hover:text-white",
                      pathname === link.href && "bg-white/10 text-white"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </Card>

            {children}
          </div>
        </Container>
      </section>
    </AdminGuard>
  );
}
