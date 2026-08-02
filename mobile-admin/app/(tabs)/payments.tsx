import { OperationsScreen } from "@/components/OperationsScreen";
import { formatDate, formatMoney } from "@/theme";
import type { PaymentSummary } from "@/types";

export default function PaymentsScreen() {
  return (
    <OperationsScreen<PaymentSummary>
      title="Payments"
      subtitle="Provider-confirmed payment ledger"
      endpoint="/api/admin/payments"
      responseKey="payments"
      filters={[
        { label: "All", value: "" },
        { label: "Review", value: "review_required" },
        { label: "Pending", value: "pending" },
        { label: "Paid", value: "paid" },
        { label: "Expired", value: "expired" },
        { label: "Refunded", value: "refunded" },
      ]}
      mapCard={(item) => ({
        title: item.customerName,
        subtitle: item.customerEmail || item.orderId,
        status: item.status,
        secondaryStatus: item.provider,
        meta: [formatMoney(item.amount, item.currency), item.purpose.replace(/_/g, " "), formatDate(item.createdAt)],
      })}
      detailPath={(item) => `/api/admin/payments/${item.id}`}
      detailKey="payment"
      actions={(item) => [
        ...(item.provider === "bank_transfer" && ["pending", "review_required"].includes(item.status)
          ? [
              { label: "Approve transfer", tone: "primary" as const, method: "PATCH" as const, path: `/api/admin/payments/${item.id}/bank-transfer-review`, body: { decision: "approve" } },
              { label: "Reject transfer", tone: "danger" as const, method: "PATCH" as const, path: `/api/admin/payments/${item.id}/bank-transfer-review`, inputLabel: "Rejection reason", buildBody: (reason: string) => ({ decision: "reject", reason }) },
            ]
          : []),
        ...(item.provider === "payhere" && item.status === "review_required"
          ? [
              { label: "Accept payment", tone: "primary" as const, method: "PATCH" as const, path: `/api/admin/payments/${item.id}/payhere-reconciliation`, inputLabel: "Reconciliation note", buildBody: (note: string) => ({ decision: "accept", note }) },
              { label: "Record refund", tone: "danger" as const, method: "PATCH" as const, path: `/api/admin/payments/${item.id}/payhere-reconciliation`, inputLabel: "Provider refund ID", buildBody: (providerRefundId: string) => ({ decision: "mark_refunded", providerRefundId, note: `External PayHere refund ${providerRefundId} confirmed in Quest Admin.` }) },
            ]
          : []),
        ...(item.status === "expired" && item.purpose === "tournament_registration"
          ? [{ label: "Reopen payment", tone: "secondary" as const, method: "POST" as const, path: `/api/admin/payments/${item.id}/reopen` }]
          : []),
      ]}
    />
  );
}
