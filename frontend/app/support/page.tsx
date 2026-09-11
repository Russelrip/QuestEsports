import PageLayout from "@/components/PageLayout";
import SupportInbox from "@/components/support/SupportInbox";
import { buildNoIndexMetadata } from "@/lib/site";
export const metadata = buildNoIndexMetadata("Support inbox", "Contact Quest Support and manage your conversations.", "/support");
export default function SupportPage() { return <PageLayout title="Support inbox" description="Get help and track replies in one place."><SupportInbox /></PageLayout>; }
