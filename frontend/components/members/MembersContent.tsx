import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { teamMembers } from "@/lib/site";

const wingLeadership = [
  "Women's Wing Leader",
  "PC Games Wing Admin",
  "Mobile Games Wing Admin",
] as const;

const upcomingMemberGroups = [
  { title: "Managers", label: "Manager" },
  { title: "Teams", label: "Team" },
  { title: "Solo Players", label: "Solo Player" },
] as const;

function PlaceholderAvatar({ label }: { label: string }) {
  return (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#09080e]">
      <div className="absolute inset-5 rounded-[24px] border border-dashed border-white/10" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5">
        <span className="font-display text-3xl text-white/70">?</span>
      </div>
      <p className="absolute bottom-5 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
        {label}
      </p>
    </div>
  );
}

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
          {wingLeadership.map((role) => (
            <Card key={role} className="overflow-hidden">
              <PlaceholderAvatar label="To Be Determined" />
              <div className="p-5 text-center">
                <h3 className="text-xl text-white">{role}</h3>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-cyan-100/60">
                  To Be Determined
                </p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {upcomingMemberGroups.map((group) => (
        <Section key={group.title} className="pt-2">
          <div className="mb-7">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">
              To Be Determined
            </p>
            <h2 className="mt-3 text-3xl text-white sm:text-4xl">{group.title}</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={`${group.title}-${index}`} className="overflow-hidden">
                <PlaceholderAvatar label="To Be Determined" />
                <div className="p-5 text-center">
                  <h3 className="text-xl text-white">
                    {group.label} {index + 1}
                  </h3>
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-cyan-100/60">
                    To Be Determined
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}
