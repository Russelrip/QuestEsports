import PageHeader from "@/components/PageHeader";
import RegistrationForm from "@/components/registration/RegistrationForm";

export default function RegistrationPage() {
  return (
    <>
      {/* This legacy registration route currently renders a frontend-only form scaffold. */}
      <PageHeader
        title="Team Registration"
        description="Join Quest Esports tournaments"
      />
      <RegistrationForm />
    </>
  );
}
