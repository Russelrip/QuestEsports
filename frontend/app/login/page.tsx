import LoginForm from "@/components/auth/LoginForm";
import PageHeader from "@/components/PageHeader";

export default function LoginPage() {
  return (
    <>
      {/* This route is just a thin wrapper around the shared page heading and login form. */}
      <PageHeader
        title="Login"
        description="Access your Quest Esports account"
      />
      <LoginForm />
    </>
  );
}
