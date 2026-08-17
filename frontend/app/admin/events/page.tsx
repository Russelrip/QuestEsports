import AdminEventsManager from "@/components/admin/AdminEventsManager";
import { buildNoIndexMetadata } from "@/lib/site";
export const metadata = buildNoIndexMetadata("Events", "Manage event identities and child tournaments.", "/admin/events");
export default function AdminEventsPage() { return <AdminEventsManager />; }
