import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";
import PageLayout from "@/components/PageLayout";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata("Login", defaultPageDescriptions.login, "/login");

export default function LoginPage() {
  return (
    <PageLayout title="Login" description={defaultPageDescriptions.login} showEyebrow={false}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </PageLayout>
  );
}
