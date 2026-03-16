import PageHeader from "@/components/PageHeader";
import SignupForm from "@/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <>
      <PageHeader
        title="Create Account"
        description="Join Quest Esports and start competing"
      />
      <SignupForm />
    </>
  );
}
