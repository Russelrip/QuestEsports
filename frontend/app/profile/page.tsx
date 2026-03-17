import PageLayout from "@/components/PageLayout";
import ProfileView from "@/components/auth/ProfileView";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "My Profile",
  defaultPageDescriptions.profile,
  "/profile"
);

export default function ProfilePage() {
  return (
    <PageLayout title="My Profile" description={defaultPageDescriptions.profile}>
      <ProfileView />
    </PageLayout>
  );
}
