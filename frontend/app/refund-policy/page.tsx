import PageLayout from "@/components/PageLayout";
import RefundPolicyContent from "@/components/refund/RefundPolicyContent";
import { buildPageMetadata } from "@/lib/site";

export const metadata = buildPageMetadata({ title: "Refund and Return Policy", description: "Read the Quest E-sports policy for customized merchandise and tournament fees.", path: "/refund-policy" });
export default function RefundPolicyPage() { return <PageLayout title="Refund & Return Policy" description="Customized merchandise and tournament payment policy."><RefundPolicyContent /></PageLayout>; }
