import PageLayout from "@/components/PageLayout";
import RegistrationForm from "@/components/registration/RegistrationForm";
import { defaultPageDescriptions } from "@/lib/site";

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
