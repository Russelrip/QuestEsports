"use client";

import RosterMemberFields from "@/components/tournament-registration/RosterMemberFields";
import type { MemberFieldGroup, TournamentRegistrationFormData } from "@/lib/tournament-registration";

export default function RegistrationRosterSection({
  legend,
  groups,
  values,
  onChange,
}: {
  legend: string;
  groups: MemberFieldGroup[];
  values: TournamentRegistrationFormData;
  onChange: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
}) {
  return (
    <section className="grid gap-4">
      <div>
        <h3 className="text-2xl text-white">{legend}</h3>
      </div>
      {groups.map((player) => (
        <RosterMemberFields
          key={player.key}
          prefix={player.key}
          title={player.title}
          required={player.required}
          values={values}
          onChange={onChange}
        />
      ))}
    </section>
  );
}
