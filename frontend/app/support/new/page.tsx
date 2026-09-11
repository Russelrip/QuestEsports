import PageLayout from "@/components/PageLayout";
import SupportInbox from "@/components/support/SupportInbox";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata("New support conversation", "Get help from Quest Support.", "/support/new");
export default function NewSupportConversationPage() {
  return <PageLayout title="Support inbox" description="Get help and track replies in one place."><SupportInbox composing /></PageLayout>;
}
