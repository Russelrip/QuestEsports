"use client";

import EmptyState from "@/components/ui/empty-state";

export default function ValorantEmptyState({
  title = "Nothing here yet",
  description = "No VALORANT data to show yet.",
  children,
}: {
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return <EmptyState title={title} description={description}>{children}</EmptyState>;
}
