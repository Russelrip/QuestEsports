import PageLayout from "@/components/PageLayout";
import TermsOfServiceContent from "@/components/terms/TermsOfServiceContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Terms of Service",
  description: defaultPageDescriptions.termsOfService,
  path: "/terms-of-service",
  keywords: [
    "terms of service",
    "Quest Esports terms",
    "questesports.lk terms",
    "tournament platform terms",
  ],
});

export default function TermsOfServicePage() {
  return (
    <PageLayout
      title="Terms of Service"
      description="Read the rules, responsibilities, and platform conditions that apply when you use Quest Esports and participate in our tournaments and services."
    >
      <TermsOfServiceContent />
    </PageLayout>
  );
}
