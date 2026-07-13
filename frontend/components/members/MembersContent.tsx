import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { teamMembers } from "@/lib/site";

const wingLeadership = [{ name: "Ayodhya “LIEBE” Janz", role: "CODM Wing Leader", image: "/images/ayodhya-liebe.jpg" }] as const;

export default function MembersContent() {
  return (
    <>
      <Section className="pt-4 sm:pt-6">
        <div className="mb-7">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Leadership</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">People Behind Quest</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {teamMembers.map((member) => (
            <Card key={member.name} className="group overflow-hidden">
              <div className="relative aspect-[4/5] overflow-hidden">
                <Image
                  src={member.image}
                  alt={member.name}
                  fill
                  sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="space-y-2 p-5">
                <h3 className="text-xl text-white">{member.name}</h3>
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/70">
                  {member.role}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section className="pt-2">
        <div className="mb-7">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Wing Leadership</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Community Wing Admins</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {wingLeadership.map((member) => (
            <Card key={member.name} className="group overflow-hidden md:max-w-md">
              <div className="relative aspect-[4/3] overflow-hidden bg-[#09080e]">
                <Image src={member.image} alt={member.name} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" />
              </div>
              <div className="p-5">
                <h3 className="text-xl text-white">{member.name}</h3>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-cyan-100/60">
                  {member.role}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
