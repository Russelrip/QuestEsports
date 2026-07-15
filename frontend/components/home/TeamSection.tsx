import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { teamMembers } from "@/lib/site";

export default function TeamSection() {
  return (
    <Section>
      <div className="mb-8">
        <h2 className="text-3xl text-white sm:text-4xl">People Behind Quest</h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {teamMembers.map((member) => (
          <Card key={member.name} className="overflow-hidden">
            <div className="relative aspect-[4/5]">
              <Image
                src={member.image}
                alt={member.name}
                fill
                sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
              />
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
