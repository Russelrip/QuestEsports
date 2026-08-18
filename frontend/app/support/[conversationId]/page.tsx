import PageLayout from "@/components/PageLayout";
import SupportInbox from "@/components/support/SupportInbox";
export default async function SupportConversationPage({ params }: { params: Promise<{ conversationId: string }> }) { const { conversationId } = await params; return <PageLayout title="Support conversation" description="Your private Quest Support conversation."><SupportInbox conversationId={conversationId} /></PageLayout>; }
