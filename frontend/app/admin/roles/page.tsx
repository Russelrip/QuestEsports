import AdminStaffRolesManager from "@/components/admin/AdminStaffRolesManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Staff Roles",
  "Bundle admin areas into roles and see who holds them.",
  "/admin/roles"
);

export default function AdminRolesPage() {
  return <AdminStaffRolesManager />;
}
