import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, buildQuery } from "@/api";
import type { ApiEnvelope, Pagination } from "@/types";
import { hasNextResourcePage, mergeUniqueResourcePage } from "@/resource-pages";

type ResourceOptions<T> = {
  endpoint: string;
  responseKey: string;
  search?: string;
  filterKey?: string;
  filterValue?: string;
  pageSize?: number;
  transform?: (value: unknown) => T[];
};

export function useResource<T extends { id: string }>({
  endpoint,
  responseKey,
  search = "",
  filterKey = "status",
  filterValue = "",
  pageSize = 50,
  transform,
}: ResourceOptions<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const loadPage = useCallback(
    async (page: number, mode: "replace" | "append", refresh = false) => {
      const currentRequest = ++requestNumber.current;
      if (refresh) setRefreshing(true);
      else if (mode === "append") setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const query = buildQuery({
          page,
          pageSize,
          search: search.trim() || undefined,
          [filterKey]: filterValue || undefined,
        });
        const data = await apiRequest<ApiEnvelope & { pagination?: Pagination }>(`${endpoint}${query}`);
        if (currentRequest !== requestNumber.current) return;
        const raw = data[responseKey];
        const nextItems = transform ? transform(raw) : Array.isArray(raw) ? (raw as T[]) : [];
        setItems((currentItems) => {
          if (mode === "replace") return nextItems;
          return mergeUniqueResourcePage(currentItems, nextItems);
        });
        setPagination(data.pagination || null);
      } catch (caught) {
        if (currentRequest !== requestNumber.current) return;
        setError(caught instanceof Error ? caught.message : "Unable to load records.");
      } finally {
        if (currentRequest === requestNumber.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [endpoint, filterKey, filterValue, pageSize, responseKey, search, transform]
  );

  useEffect(() => {
    const timeout = setTimeout(() => void loadPage(1, "replace"), 300);
    return () => {
      clearTimeout(timeout);
      requestNumber.current += 1;
    };
  }, [loadPage]);

  const hasMore = hasNextResourcePage(pagination);
  const loadNext = () => {
    if (!pagination || !hasMore || loading || refreshing || loadingMore) return;
    void loadPage(pagination.page + 1, "append");
  };

  return {
    items,
    pagination,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    reload: () => loadPage(1, "replace", true),
    loadNext,
  };
}
