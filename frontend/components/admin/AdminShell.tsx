"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminGuard from "@/components/admin/AdminGuard";
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
      <section className="admin-section">
        <div className="container admin-dashboard">
          <div className="admin-header">
            <div>
              <span className="profile-badge">Admin Dashboard</span>
              <h2>{title}</h2>
              <p className="section-intro admin-section-intro">{description}</p>
            </div>
            {actions || null}
          </div>

          <nav className="admin-tabs" aria-label="Admin navigation">
            {adminNavigationLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`admin-tab ${pathname === link.href ? "is-active" : ""}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {children}
        </div>
      </section>
    </AdminGuard>
  );
}
