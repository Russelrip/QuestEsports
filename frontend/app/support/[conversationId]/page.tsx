import PageLayout from "@/components/PageLayout";
import SupportInbox from "@/components/support/SupportInbox";
export default async function SupportConversationPage({ params, searchParams }: { params: Promise<{ conversationId: string }>; searchParams: Promise<{ sent?: string }> }) { const { conversationId } = await params; const { sent } = await searchParams; return <PageLayout title="Support inbox" description="Get help and track replies in one place."><SupportInbox conversationId={conversationId} sent={sent === "1"} /></PageLayout>; }
