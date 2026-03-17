import PageLayout from "@/components/PageLayout";
import AdminUsersManager from "@/components/admin/AdminUsersManager";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "User Management",
  defaultPageDescriptions.adminUsers,
  "/admin/users"
);

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
