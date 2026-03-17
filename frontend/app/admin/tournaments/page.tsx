import PageLayout from "@/components/PageLayout";
import AdminTournamentsManager from "@/components/admin/AdminTournamentsManager";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminTournamentsPage() {
  return (
    <PageLayout
      title="Tournament Management"
      description={defaultPageDescriptions.adminTournaments}
    >
      <AdminTournamentsManager />
    </PageLayout>
  );
}
