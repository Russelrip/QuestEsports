import AdminTicketsManager from "@/components/admin/AdminTicketsManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Ticketing",
  "Manage event tickets, payments, QR codes, and check-ins.",
  "/admin/tickets",
);

export default function AdminTicketsPage() {
  return <AdminTicketsManager />;
}
