import PageLayout from "@/components/PageLayout";
import RegistrationForm from "@/components/registration/RegistrationForm";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Create Team",
  description: defaultPageDescriptions.registration,
  path: "/registration",
  keywords: [
    "create e-sports team",
    "gaming team roster",
    "invite team members",
  ],
});

export default function RegistrationPage() {
  return (
    <PageLayout
      title="Teams"
      description={defaultPageDescriptions.registration}
    >
      <RegistrationForm />
    </PageLayout>
  );
}
