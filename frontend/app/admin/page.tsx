import AdminDashboard from "@/components/admin/AdminDashboard";
import PageLayout from "@/components/PageLayout";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminPage() {
  return (
    <PageLayout title="Admin Dashboard" description={defaultPageDescriptions.admin}>
      <AdminDashboard />
    </PageLayout>
  );
}
