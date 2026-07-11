import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import VerifyEmailContent from "@/components/auth/VerifyEmailContent";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Verify Email",
  "Verify your Quest E-sports account email address.",
  "/verify-email"
);

export default function VerifyEmailPage() {
  return (
    <PageLayout
      title="Verify Email"
      description="Confirm your email address to unlock full Quest E-sports account access."
      showEyebrow={false}
    >
      <Suspense fallback={null}>
        <VerifyEmailContent />
      </Suspense>
    </PageLayout>
  );
}
