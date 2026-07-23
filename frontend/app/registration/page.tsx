import PageLayout from "@/components/PageLayout";
import RegistrationForm from "@/components/registration/RegistrationForm";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Create Team",
  defaultPageDescriptions.registration,
  "/registration"
);

export default function RegistrationPage() {
  return (
    <PageLayout
      title="Create a Saved Team"
      description={defaultPageDescriptions.registration}
    >
      <RegistrationForm />
    </PageLayout>
  );
}
