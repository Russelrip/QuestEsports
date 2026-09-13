"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { adminHomeFor, canOpenAdminPath } from "@/lib/staff-permissions";

export default function AdminGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, sessionError, refreshSession } = useAuth();
  // Admins open everything. Staff open only the areas they were granted; any
  // other admin page sends them to the first area they do have.
  const allowed = Boolean(user) && canOpenAdminPath(user, pathname);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!user) {
      if (!sessionError) router.replace("/login");
      return;
    }

    if (!allowed) {
      router.replace(adminHomeFor(user) ?? "/");
    }
  }, [allowed, isLoading, router, sessionError, user]);

  if (!isLoading && sessionError && !user) {
    return (
      <EmptyState
        title="Admin access could not be checked"
        description={sessionError}
      >
        <Button className="mb-4" onClick={() => void refreshSession()}>
          Try again
        </Button>
      </EmptyState>
    );
  }

  if (isLoading || !user || !allowed) {
    return <EmptyState description="Checking admin access..." />;
  }

  return <>{children}</>;
}
