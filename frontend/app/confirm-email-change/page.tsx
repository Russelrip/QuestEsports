import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import ConfirmEmailChangeContent from "@/components/auth/ConfirmEmailChangeContent";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Confirm Email Change",
  "Confirm the new email address for your Quest Esports account.",
  "/confirm-email-change"
);

export default function ConfirmEmailChangePage() {
  return (
    <PageLayout
      title="Confirm Email Change"
      description="Finish updating your Quest Esports account email address."
      showEyebrow={false}
    >
      <Suspense fallback={null}>
        <ConfirmEmailChangeContent />
      </Suspense>
    </PageLayout>
  );
}
