import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Reset Password",
  "Reset your Quest Esports account password.",
  "/reset-password"
);

export default function ResetPasswordPage() {
  return (
    <PageLayout
      title="Reset Password"
      description="Choose a new password using your Quest Esports reset link."
      showEyebrow={false}
    >
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </PageLayout>
  );
}
