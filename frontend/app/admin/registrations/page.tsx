import PageLayout from "@/components/PageLayout";
import AdminRegistrationsManager from "@/components/admin/AdminRegistrationsManager";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminRegistrationsPage() {
  return (
    <PageLayout
      title="Registration Management"
      description={defaultPageDescriptions.adminRegistrations}
    >
      <AdminRegistrationsManager />
    </PageLayout>
  );
}
