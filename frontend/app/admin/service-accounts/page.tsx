import AdminServiceAccountsManager from "@/components/admin/AdminServiceAccountsManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Service Accounts",
  "Accounts and tokens for bots and agents.",
  "/admin/service-accounts"
);

export default function AdminServiceAccountsPage() {
  return <AdminServiceAccountsManager />;
}
