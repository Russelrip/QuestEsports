import { OperationsScreen } from "@/components/OperationsScreen";
import { formatDate } from "@/theme";
import type { RegistrationSummary } from "@/types";

export default function RegistrationsScreen() {
  return (
    <OperationsScreen<RegistrationSummary>
      title="Registrations"
      subtitle="Pull down to refresh"
      endpoint="/api/admin/team-registrations"
      responseKey="registrations"
      filters={[
        { label: "All", value: "" },
        { label: "Pending", value: "pending" },
        { label: "Approved", value: "approved" },
        { label: "Rejected", value: "rejected" },
      ]}
      mapCard={(item) => ({
        title: item.teamName,
        subtitle: item.tournament.title,
        status: item.status,
        secondaryStatus: item.paymentStatus,
        meta: [`${item.memberCount} roster members`, item.captain.email, formatDate(item.createdAt)],
      })}
      detailPath={(item) => `/api/admin/team-registrations/${item.id}`}
      detailKey="registration"
      actions={(item) => [
        ...(item.status !== "approved" ? [{ label: "Approve", tone: "primary" as const, method: "PATCH" as const, path: `/api/admin/team-registrations/${item.id}/status`, body: { status: "approved" } }] : []),
        ...(item.status !== "pending" ? [{ label: "Mark pending", tone: "secondary" as const, method: "PATCH" as const, path: `/api/admin/team-registrations/${item.id}/status`, body: { status: "pending" } }] : []),
        ...(item.status !== "rejected" ? [{ label: "Reject", tone: "danger" as const, method: "PATCH" as const, path: `/api/admin/team-registrations/${item.id}/status`, body: { status: "rejected" } }] : []),
        { label: "Delete", tone: "danger" as const, method: "DELETE" as const, path: `/api/admin/team-registrations/${item.id}`, confirm: "Permanently delete this registration? This cannot be undone." },
      ]}
    />
  );
}
