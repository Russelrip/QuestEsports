import PageHeader from "@/components/PageHeader";
import ProfileView from "@/components/auth/ProfileView";

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        title="My Profile"
        description="View your account details and update your player profile"
      />
      <ProfileView />
    </>
  );
}
