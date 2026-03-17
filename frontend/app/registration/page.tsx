import PageLayout from "@/components/PageLayout";
import RegistrationForm from "@/components/registration/RegistrationForm";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Team Registration",
  description: defaultPageDescriptions.registration,
  path: "/registration",
  keywords: [
    "esports team registration",
    "register gaming team",
    "competitive roster signup",
    "tournament entry form",
  ],
});

export default function RegistrationPage() {
  return (
    <PageLayout
      title="Team Registration"
      description={defaultPageDescriptions.registration}
    >
      <RegistrationForm />
    </PageLayout>
  );
}
