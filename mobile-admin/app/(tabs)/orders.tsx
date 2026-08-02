import { OperationsScreen } from "@/components/OperationsScreen";
import { formatDate, formatMoney } from "@/theme";
import type { MerchandiseOrder } from "@/types";

export default function OrdersScreen() {
  return (
    <OperationsScreen<MerchandiseOrder>
      title="Orders"
      subtitle="Merchandise fulfilment"
      endpoint="/api/admin/orders"
      responseKey="orders"
      filters={[
        { label: "All", value: "" },
        { label: "Pending", value: "pending_payment" },
        { label: "Paid", value: "paid" },
        { label: "Processing", value: "processing" },
        { label: "Fulfilled", value: "fulfilled" },
        { label: "Cancelled", value: "cancelled" },
      ]}
      mapCard={(item) => ({
        title: `${item.firstName} ${item.lastName}`,
        subtitle: item.email,
        status: item.status,
        secondaryStatus: item.paymentStatus,
        meta: [formatMoney(item.total, item.currency), `${item.items.length} line items`, formatDate(item.createdAt)],
      })}
      actions={(item) => [
        ...(["paid", "processing"].includes(item.status) && item.status !== "processing"
          ? [{ label: "Start processing", tone: "primary" as const, method: "PATCH" as const, path: `/api/admin/orders/${item.id}`, body: { status: "processing" } }]
          : []),
        ...(item.status === "processing"
          ? [{ label: "Mark fulfilled", tone: "primary" as const, method: "PATCH" as const, path: `/api/admin/orders/${item.id}`, body: { status: "fulfilled" } }]
          : []),
        ...(item.status === "pending_payment"
          ? [{ label: "Cancel order", tone: "danger" as const, method: "PATCH" as const, path: `/api/admin/orders/${item.id}`, body: { status: "cancelled" } }]
          : []),
      ]}
    />
  );
}
