import AdminMatchRoomsManager from "@/components/admin/AdminMatchRoomsManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Match Rooms",
  "Operate profile-linked match chat, support and map veto rooms.",
  "/admin/match-rooms",
);

export default function AdminMatchRoomsPage() {
  return <AdminMatchRoomsManager />;
}
