"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type QueryOptions<TData> = {
  enabled?: boolean;
  initialData?: TData | null;
};

export function useApiQuery<TData>(
  key: unknown[],
  queryFn: () => Promise<TData>,
  options: QueryOptions<TData> = {}
) {
  const { enabled = true, initialData = null } = options;
  const [data, setData] = useState<TData | null>(initialData);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);

  const stableKey = useMemo(() => JSON.stringify(key), [key]);

  const refetch = useCallback(async () => {
    if (!enabled) {
      return null;
    }

    setLoading(true);
    setError("");

    try {
      const nextData = await queryFn();
      setData(nextData);
      return nextData;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Request failed.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, queryFn]);

  useEffect(() => {
    void refetch();
  }, [refetch, stableKey]);

  return {
    data,
    setData,
    error,
    loading,
    refetch,
  };
}
