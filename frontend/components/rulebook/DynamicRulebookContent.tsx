import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import type { Rulebook } from "@/lib/rulebooks";

export default function DynamicRulebookContent({ rulebook }: { rulebook: Rulebook }) {
  return (
    <Section className="pt-6">
      <Card className="p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">
          {rulebook.game} / {rulebook.variant}
        </p>
        <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-300 sm:text-base">
          {rulebook.content}
        </div>
      </Card>
    </Section>
  );
}
