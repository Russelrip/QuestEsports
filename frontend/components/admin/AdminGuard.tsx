"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function AdminGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, isLoading, sessionError, refreshSession } = useAuth();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!user) {
      if (!sessionError) router.replace("/login");
      return;
    }

    if (user.role !== "admin") {
      router.replace("/");
    }
  }, [isLoading, router, sessionError, user]);

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

  if (isLoading || !user || user.role !== "admin") {
    return <EmptyState description="Checking admin access..." />;
  }

  return <>{children}</>;
}
