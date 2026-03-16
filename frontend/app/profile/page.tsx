import PageLayout from "@/components/PageLayout";
import ProfileView from "@/components/auth/ProfileView";
import { defaultPageDescriptions } from "@/lib/site";

export default function ProfilePage() {
  return (
    <PageLayout title="My Profile" description={defaultPageDescriptions.profile}>
      <ProfileView />
    </PageLayout>
  );
}
