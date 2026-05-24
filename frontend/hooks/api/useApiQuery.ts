"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const stableKey = JSON.stringify(key);
  const [data, setData] = useState<TData | null>(initialData);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const queryFnRef = useRef(queryFn);
  const requestIdRef = useRef(0);

  useEffect(() => {
    queryFnRef.current = queryFn;
  }, [queryFn]);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");

    try {
      const nextData = await queryFnRef.current();
      if (requestIdRef.current === requestId) {
        setData(nextData);
      }
      return nextData;
    } catch (nextError) {
      if (requestIdRef.current === requestId) {
        setError(nextError instanceof Error ? nextError.message : "Request failed.");
      }
      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [enabled]);

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
