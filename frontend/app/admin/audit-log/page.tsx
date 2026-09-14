import { Suspense } from "react";
import AdminAuditLog from "@/components/admin/AdminAuditLog";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Audit log",
  "Review every recorded change across Quest E-sports: who made it, from where, and what it changed.",
  "/admin/audit-log"
);

export default function AdminAuditLogPage() {
  // The log reads its opening filters from the URL.
  return (
    <Suspense>
      <AdminAuditLog />
    </Suspense>
  );
}
