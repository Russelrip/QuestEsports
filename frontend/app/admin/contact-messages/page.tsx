import AdminContactMessagesManager from "@/components/admin/AdminContactMessagesManager";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Contact Messages",
  defaultPageDescriptions.adminContactMessages,
  "/admin/contact-messages"
);

export default function AdminContactMessagesPage() {
  return <AdminContactMessagesManager />;
}
