import PageHeader from "@/components/PageHeader";
import SignupForm from "@/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <>
      {/* Signup uses the same page shell pattern as the other inner routes. */}
      <PageHeader
        title="Create Account"
        description="Join Quest Esports and start competing"
      />
      <SignupForm />
    </>
  );
}
