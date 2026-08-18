import type { ReactNode } from "react";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Administration",
  "Quest E-sports administration area.",
  "/admin"
);

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div data-admin-route>{children}</div>;
}
