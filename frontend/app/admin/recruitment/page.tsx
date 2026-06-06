import AdminRecruitmentManager from "@/components/admin/AdminRecruitmentManager";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Recruitment Applications",
  "Review Join Quest recruitment applications.",
  "/admin/recruitment"
);

export default function AdminRecruitmentPage() {
  return <AdminRecruitmentManager />;
}
