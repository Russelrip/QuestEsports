import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

export default function AboutSection() {
  return (
    <Section className="pt-4">
      <Card className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">About Quest</p>
          <h2 className="mt-4 text-3xl text-white sm:text-4xl">A tournament brand, not just a bracket page.</h2>
        </div>
        <p className="text-sm leading-7 text-slate-300 sm:text-base">
          Quest Esports is focused on competitive gaming experiences that feel organized, credible, and exciting from the first announcement through the final highlight reel. The platform supports real tournament operations, community growth, and the media layer that keeps players engaged between events.
        </p>
      </Card>
    </Section>
  );
}
