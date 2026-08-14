import AdminVetoRoomsManager from "@/components/admin/AdminVetoRoomsManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Veto Rooms",
  "Create and operate Valorant toss and map veto rooms.",
  "/admin/veto-rooms",
);

export default function AdminVetoRoomsPage() {
  return <AdminVetoRoomsManager />;
}
