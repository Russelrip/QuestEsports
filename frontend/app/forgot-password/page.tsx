import PageLayout from "@/components/PageLayout";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Forgot Password",
  "Request a password reset email for your Quest Esports account.",
  "/forgot-password"
);

export default function ForgotPasswordPage() {
  return (
    <PageLayout
      title="Forgot Password"
      description="Request a secure password reset link for your Quest Esports account."
    >
      <ForgotPasswordForm />
    </PageLayout>
  );
}
