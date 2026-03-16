import PageLayout from "@/components/PageLayout";
import SignupForm from "@/components/auth/SignupForm";
import { defaultPageDescriptions } from "@/lib/site";

export default function SignupPage() {
  return (
    <PageLayout title="Create Account" description={defaultPageDescriptions.signup}>
      <SignupForm />
    </PageLayout>
  );
}
