import AdminRulebooksManager from "@/components/admin/AdminRulebooksManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Rulebook Management",
  "Create and manage reusable tournament rulebooks.",
  "/admin/rulebooks"
);

export default function AdminRulebooksPage() {
  return <AdminRulebooksManager />;
}
