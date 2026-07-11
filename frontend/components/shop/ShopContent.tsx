import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

export default function ShopContent() {
  return (
    <Section className="pt-4 sm:pt-6">
      <Card className="relative overflow-hidden p-6 sm:p-10 lg:p-14">
        <div className="relative grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div className="max-w-2xl">
            <Badge className="border-violet-300/20 bg-violet-400/10 text-violet-100">
              Coming Soon
            </Badge>
            <h2 className="mt-6 text-3xl leading-tight text-white sm:text-4xl lg:text-5xl">
              Quest merch is on the way.
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
              Our first Quest E-sports T-shirt drop is being prepared. Product artwork,
              sizes, pricing, and ordering details will appear here once the official
              poster is ready.
            </p>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
              Wear the quest. Represent the community.
            </p>
          </div>

          <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center rounded-[32px] border border-white/10 bg-black/20">
            <div className="absolute inset-5 rounded-[26px] border border-dashed border-white/10" />
            <div className="relative flex h-44 w-44 items-center justify-center rounded-[36px] border border-violet-300/20 bg-[#11101a] shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:h-52 sm:w-52">
              <span className="font-display text-6xl tracking-[0.12em] text-white sm:text-7xl">
                Q
              </span>
            </div>
            <p className="absolute bottom-8 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              Poster reveal pending
            </p>
          </div>
        </div>
      </Card>
    </Section>
  );
}
