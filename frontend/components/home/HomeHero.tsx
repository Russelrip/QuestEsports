import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

const stats = [
  { label: "Live registrations", value: "Open now" },
  { label: "Community first", value: "Sri Lanka" },
  { label: "Ops + media", value: "One platform" },
];

export default function HomeHero() {
  return (
    <section className="relative overflow-hidden pb-10 pt-12 sm:pb-16 sm:pt-16">
      <Container>
        <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,11,30,0.96),rgba(8,8,15,0.92))] px-6 py-12 shadow-[0_28px_100px_rgba(0,0,0,0.35)] sm:px-10 sm:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_left,rgba(139,92,246,0.18),transparent_32%)]" />
          <div className="relative grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div className="max-w-3xl">
              <Badge>Competitive Platform</Badge>
              <h1 className="mt-6 text-5xl leading-[0.95] text-white sm:text-6xl lg:text-7xl">
                Run premium esports events with a UI that feels match ready.
              </h1>
              <p className="mt-6 max-w-2xl text-base text-slate-300 sm:text-lg">
                Quest Esports brings registrations, tournament discovery, match content, and player workflows into one cohesive platform.
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

            <div className="grid gap-4">
              <div className="rounded-[28px] border border-white/10 bg-black/30 p-6">
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Current feel</p>
                <p className="mt-3 font-display text-2xl text-white">Valorant sharpness, SaaS clarity, production-ready workflows.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{stat.label}</p>
                    <p className="mt-3 text-lg font-semibold text-white">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
