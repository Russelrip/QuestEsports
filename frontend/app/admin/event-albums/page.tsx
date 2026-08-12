import AdminEventAlbumsManager from "@/components/admin/AdminEventAlbumsManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Event Albums",
  "Manage event photography albums and tournament artwork.",
  "/admin/event-albums",
);

export default function AdminEventAlbumsPage() {
  return <AdminEventAlbumsManager />;
}
