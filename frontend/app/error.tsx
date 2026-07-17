"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route rendering failed", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <section className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-6 py-20">
      <div className="w-full border border-white/10 bg-slate-950/80 p-8 text-center shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">
          Temporary problem
        </p>
        <h1 className="mt-3 text-3xl font-bold text-white">This page could not be loaded</h1>
        <p className="mt-4 text-slate-300">
          Your account and submitted information are safe. Try loading the page again, or return
          home if the problem continues.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            Try again
          </button>
          <Link
            href="/"
            className="border border-white/20 px-5 py-3 font-semibold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Return home
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 text-xs text-slate-500">Reference: {error.digest}</p>
        ) : null}
      </div>
    </section>
  );
}
