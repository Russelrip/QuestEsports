import Link from "next/link";
import HomeMediaSlideshow from "@/components/home/HomeMediaSlideshow";
import { buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function HomeHero() {
  return (
    <section className="relative overflow-hidden pb-4 pt-8 sm:pb-6 sm:pt-10">
      <Container>
        <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[#0d0c13] px-6 py-12 shadow-[0_28px_100px_rgba(0,0,0,0.35)] sm:px-10 sm:py-16">
          <div className="relative grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100/70">
                Sri Lanka Esports Community
              </p>
              <h1 className="mt-5 text-5xl leading-[0.95] text-white sm:text-6xl lg:text-7xl">
                Welcome to Quest E-Sports LK
              </h1>
              <p className="mt-6 max-w-2xl text-base text-slate-300 sm:text-lg">
                Follow our tournaments, Spectra match moments, player face cams, interviews,
                and the community behind every Quest event.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/tournaments" className={buttonClassName({ size: "lg" })}>
                  Explore Tournaments
                </Link>
                <Link
                  href="/tournament-registration"
                  className={buttonClassName({ variant: "secondary", size: "lg" })}
                >
                  Register Your Team
                </Link>
              </div>
            </div>

            <HomeMediaSlideshow />
          </div>
        </div>
      </Container>
    </section>
  );
}
