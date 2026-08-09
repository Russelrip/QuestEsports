import AdminMediaManager from "@/components/admin/AdminMediaManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Media Library",
  "Browse and manage Quest E-sports public media assets.",
  "/admin/media",
);

export default function AdminMediaPage() {
  return <AdminMediaManager />;
}
