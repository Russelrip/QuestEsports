import PageHeader from "@/components/PageHeader";
import RegistrationForm from "@/components/registration/RegistrationForm";

export default function RegistrationPage() {
  return (
    <>
      <PageHeader
        title="Team Registration"
        description="Join Quest Esports tournaments"
      />
      <RegistrationForm />
    </>
  );
}
