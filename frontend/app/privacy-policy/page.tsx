import PageLayout from "@/components/PageLayout";
import PrivacyPolicyContent from "@/components/privacy/PrivacyPolicyContent";
import { buildPageMetadata } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description:
    "Read how Quest Esports collects, uses, stores, and protects account, tournament, and contact information on questesports.lk.",
  path: "/privacy-policy",
  keywords: [
    "privacy policy",
    "Quest Esports privacy",
    "questesports.lk privacy policy",
    "tournament registration privacy",
  ],
});

export default function PrivacyPolicyPage() {
  return (
    <PageLayout
      title="Privacy Policy"
      description="Learn what information Quest Esports collects, why we use it, and how we handle account, tournament, and contact data."
    >
      <PrivacyPolicyContent />
    </PageLayout>
  );
}
