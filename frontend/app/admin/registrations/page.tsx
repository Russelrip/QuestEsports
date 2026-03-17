import PageLayout from "@/components/PageLayout";
import AdminRegistrationsManager from "@/components/admin/AdminRegistrationsManager";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Registration Management",
  defaultPageDescriptions.adminRegistrations,
  "/admin/registrations"
);

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
