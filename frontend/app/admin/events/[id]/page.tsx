import AdminEventDashboard from "@/components/admin/AdminEventDashboard";
import { buildNoIndexMetadata } from "@/lib/site";
export const metadata = buildNoIndexMetadata("Event Dashboard", "Manage event content and tournaments.", "/admin/events/event");
export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) { return <AdminEventDashboard eventId={(await params).id} />; }
