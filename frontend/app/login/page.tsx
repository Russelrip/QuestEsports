import LoginForm from "@/components/auth/LoginForm";
import PageLayout from "@/components/PageLayout";
import { defaultPageDescriptions } from "@/lib/site";

export default function LoginPage() {
  return (
    <PageLayout title="Login" description={defaultPageDescriptions.login}>
      <LoginForm />
    </PageLayout>
  );
}
