import LoginForm from "@/components/auth/LoginForm";
import PageHeader from "@/components/PageHeader";

export default function LoginPage() {
  return (
    <>
      <PageHeader
        title="Login"
        description="Access your Quest Esports account"
      />
      <LoginForm />
    </>
  );
}
