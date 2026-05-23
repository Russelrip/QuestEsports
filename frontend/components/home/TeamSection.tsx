import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { teamMembers } from "@/lib/site";

export default function TeamSection() {
  return (
    <Section>
      <div className="mb-8 flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Operators</p>
        <h2 className="text-3xl text-white sm:text-4xl">The team behind the bracket, streams, and player experience.</h2>
        <p className="max-w-2xl text-sm text-slate-400 sm:text-base">
          Real organizers, admins, and community builders shaping the experience behind every tournament drop.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {teamMembers.map((member) => (
          <Card key={member.name} className="overflow-hidden">
            <div className="relative aspect-[4/5]">
              <Image src={member.image} alt={member.name} fill className="object-cover" />
            </div>
            <div className="space-y-2 p-5">
              <h3 className="text-xl text-white">{member.name}</h3>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">{member.role}</p>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}
