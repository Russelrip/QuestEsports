"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application rendering failed", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#07060b", color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section style={{ maxWidth: "640px", border: "1px solid #312e45", padding: "32px", textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: "30px" }}>Quest E-sports is temporarily unavailable</h1>
            <p style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
              Something unexpected happened while loading the application. Please retry now or
              refresh the page in a moment.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ border: 0, background: "#7c3aed", color: "white", padding: "12px 20px", fontWeight: 700, cursor: "pointer" }}
            >
              Try again
            </button>
            {error.digest ? <p style={{ color: "#64748b", fontSize: "12px" }}>Reference: {error.digest}</p> : null}
          </section>
        </main>
      </body>
    </html>
  );
}
