import type { Pagination } from "@/types";

export function mergeUniqueResourcePage<T extends { id: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...next.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

export function hasNextResourcePage(pagination: Pagination | null): boolean {
  return Boolean(pagination && pagination.page < pagination.totalPages);
}
