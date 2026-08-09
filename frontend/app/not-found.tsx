import type { Metadata } from "next";
import Link from "next/link";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Page Not Found",
  description: "The requested Quest E-sports page could not be found.",
  alternates: {
    canonical: null,
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function NotFoundPage() {
  return (
    <PageLayout
      title="Page not found"
      description="The page you requested does not exist or may have moved."
    >
      <section className="py-12 sm:py-16">
        <Container className="max-w-3xl">
          <div className="border border-white/10 bg-slate-950/80 p-8 text-center shadow-2xl sm:p-12">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">
              Error 404
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              We could not find that page
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">
              Check the address, browse current tournaments, or return to the
              Quest E-sports homepage.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/tournaments" className="btn btn-primary">
                View tournaments
              </Link>
              <Link href="/" className="btn btn-secondary">
                Return home
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </PageLayout>
  );
}
