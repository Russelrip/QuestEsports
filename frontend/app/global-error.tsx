"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white">
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
          <h1 className="text-4xl">Quest E-sports is temporarily unavailable</h1>
          <p className="text-slate-300">An unexpected error occurred. Please try again.</p>
          <button type="button" onClick={reset} className="rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950">Try again</button>
        </main>
      </body>
    </html>
  );
}
