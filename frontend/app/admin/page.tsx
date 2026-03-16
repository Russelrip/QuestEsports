import PageHeader from "@/components/PageHeader";
import AdminDashboard from "@/components/admin/AdminDashboard";

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Admin Dashboard"
        description="Review user activity and monitor Quest Esports account data"
      />
      <AdminDashboard />
    </>
  );
}
