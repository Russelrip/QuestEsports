import PageLayout from "@/components/PageLayout";
import AdminUsersManager from "@/components/admin/AdminUsersManager";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminUsersPage() {
  return (
    <PageLayout
      title="User Management"
      description={defaultPageDescriptions.adminUsers}
    >
      <AdminUsersManager />
    </PageLayout>
  );
}
