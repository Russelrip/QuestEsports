import Image from "next/image";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function HomeHero() {
  const heroFadeMask = {
    maskImage: "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
    WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
  };

  return (
    <section className="relative isolate flex min-h-[calc(100svh-5rem)] overflow-hidden">
      <Image
        src="/images/frontbg.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center brightness-80 saturate-100"
        style={heroFadeMask}
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,3,11,0.34)_0%,rgba(5,3,11,0.14)_38%,rgba(5,3,11,0.04)_68%,rgba(5,3,11,0.16)_100%)]"
        style={heroFadeMask}
      />

      <Container className="relative z-10 flex flex-1 items-end pb-14 pt-20 sm:pb-16 sm:pt-24 lg:items-center lg:pb-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100 drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
            Sri Lanka Esports Community
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl leading-[0.95] text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)] sm:text-6xl lg:text-8xl">
            Welcome to Quest E-Sports LK
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.85)] sm:text-lg">
            Follow tournaments, match moments, player stories, and the community behind
            every Quest event.
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
      </Container>
    </section>
  );
}
