import AdminOverview from "@/components/admin/AdminOverview";
import PageLayout from "@/components/PageLayout";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminPage() {
  return (
    <PageLayout title="Admin Overview" description={defaultPageDescriptions.admin}>
      <AdminOverview />
    </PageLayout>
  );
}
