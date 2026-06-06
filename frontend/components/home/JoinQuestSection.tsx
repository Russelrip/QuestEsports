import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const applicationTypes = [
  "Solo players",
  "Existing teams",
  "Incomplete teams",
] as const;

export default function JoinQuestSection() {
  return (
    <Section>
      <Card className="relative overflow-hidden p-6 sm:p-8 lg:p-10">
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Join Quest</p>
            <h2 className="mt-3 text-3xl text-white sm:text-4xl">
              Quest Esports Recruitment is Now Open!
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              Whether you are a solo player, an existing team, or an incomplete roster
              looking for teammates, we would love to have you join our community.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {applicationTypes.map((type) => (
                <span
                  key={type}
                  className="px-1 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200"
                >
                  {type}
                </span>
              ))}
            </div>
            <p className="mt-6 text-sm text-slate-400">
              Recruitment applications require a signed-in account with a verified email.
            </p>
          </div>
          <Link href="/join" className={buttonClassName({ size: "lg", className: "w-full lg:w-auto" })}>
            Open Recruitment Form
          </Link>
        </div>
      </Card>
    </Section>
  );
}
