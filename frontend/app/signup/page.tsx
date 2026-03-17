import PageLayout from "@/components/PageLayout";
import SignupForm from "@/components/auth/SignupForm";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Create Account",
  defaultPageDescriptions.signup,
  "/signup"
);

export default function SignupPage() {
  return (
    <PageLayout title="Create Account" description={defaultPageDescriptions.signup}>
      <SignupForm />
    </PageLayout>
  );
}
