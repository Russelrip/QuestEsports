import AdminOverview from "@/components/admin/AdminOverview";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Admin Overview",
  defaultPageDescriptions.admin,
  "/admin"
);

export default function AdminPage() {
  return <AdminOverview />;
}
