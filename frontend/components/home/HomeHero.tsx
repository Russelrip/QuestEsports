import Image from "next/image";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import type { LiveMatch } from "@/lib/matches";

export default function HomeHero({ nextMatch }: { nextMatch?: LiveMatch | null }) {
  const heroFadeMask = {
    maskImage: "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
    WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
  };

  return (
    <section className="relative isolate flex min-h-[min(760px,calc(100svh-5rem))] overflow-hidden border-b border-white/10">
      <Image
        src="/images/mainbg.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center brightness-[0.62] saturate-[0.85]"
        style={heroFadeMask}
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,15,0.92)_0%,rgba(5,7,15,0.56)_48%,rgba(5,7,15,0.22)_100%)]"
        style={heroFadeMask}
      />

      <Container className="relative z-10 flex flex-1 items-end pb-14 pt-20 sm:pb-16 sm:pt-24 lg:items-center lg:pb-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-200">
            Sri Lanka esports competition
          </p>
          <h1 className="mt-6 max-w-full leading-[0.94] text-white">
            <span className="block text-[clamp(2.8rem,8vw,6.8rem)] tracking-[-0.03em]">PLAY THE NEXT ROUND.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
            Tournaments, live fixtures, verified results, and the competitors shaping Sri Lanka&apos;s esports scene.
          </p>
          {nextMatch ? <p className="mt-5 border-l-2 border-blue-300 pl-4 text-sm text-slate-300">Next fixture: <strong className="text-white">{nextMatch.participants[0]?.displayName || "TBD"} vs {nextMatch.participants[1]?.displayName || "TBD"}</strong></p> : null}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/tournaments" className={buttonClassName({ size: "lg" })}>
              Explore Tournaments
            </Link>
            <Link href="/match-videos" className={buttonClassName({ size: "lg", variant: "secondary" })}>
              Watch Matches
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
