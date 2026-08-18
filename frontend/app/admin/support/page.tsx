import AdminSupportManager from "@/components/admin/AdminSupportManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata("Support queue", "Reply to and resolve private Quest Support conversations.", "/admin/support");

export default function AdminSupportPage() {
  return <AdminSupportManager />;
}
