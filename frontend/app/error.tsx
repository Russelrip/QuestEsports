"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-4xl text-white">This page could not be loaded</h1>
      <p className="text-slate-300">Please check your connection and try again.</p>
      <Button type="button" onClick={reset}>Try again</Button>
    </main>
  );
}
