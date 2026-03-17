import AdminOverview from "@/components/admin/AdminOverview";
import PageLayout from "@/components/PageLayout";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Admin Overview",
  defaultPageDescriptions.admin,
  "/admin"
);

export default function AdminPage() {
  return (
    <PageLayout title="Admin Overview" description={defaultPageDescriptions.admin}>
      <AdminOverview />
    </PageLayout>
  );
}
