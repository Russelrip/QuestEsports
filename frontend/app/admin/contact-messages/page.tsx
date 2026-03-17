import PageLayout from "@/components/PageLayout";
import AdminContactMessagesManager from "@/components/admin/AdminContactMessagesManager";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminContactMessagesPage() {
  return (
    <PageLayout
      title="Contact Messages"
      description={defaultPageDescriptions.adminContactMessages}
    >
      <AdminContactMessagesManager />
    </PageLayout>
  );
}
