import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, buildQuery } from "@/api";
import type { ApiEnvelope, Pagination } from "@/types";

type ResourceOptions<T> = {
  endpoint: string;
  responseKey: string;
  search?: string;
  filterKey?: string;
  filterValue?: string;
  pageSize?: number;
  transform?: (value: unknown) => T[];
};

export function useResource<T>({
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
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      const currentRequest = ++requestNumber.current;
      refresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const query = buildQuery({
          page: 1,
          pageSize,
          search: search.trim() || undefined,
          [filterKey]: filterValue || undefined,
        });
        const data = await apiRequest<ApiEnvelope & { pagination?: Pagination }>(`${endpoint}${query}`);
        if (currentRequest !== requestNumber.current) return;
        const raw = data[responseKey];
        setItems(transform ? transform(raw) : Array.isArray(raw) ? (raw as T[]) : []);
        setPagination(data.pagination || null);
      } catch (caught) {
        if (currentRequest !== requestNumber.current) return;
        setError(caught instanceof Error ? caught.message : "Unable to load records.");
      } finally {
        if (currentRequest === requestNumber.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [endpoint, filterKey, filterValue, pageSize, responseKey, search, transform]
  );

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 300);
    return () => clearTimeout(timeout);
  }, [load]);

  return { items, pagination, loading, refreshing, error, reload: () => load(true) };
}
