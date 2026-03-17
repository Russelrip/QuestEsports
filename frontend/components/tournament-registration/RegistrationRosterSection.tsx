"use client";

import RosterMemberFields from "@/components/tournament-registration/RosterMemberFields";
import type {
  MemberFieldGroup,
  TournamentRegistrationFormData,
} from "@/lib/tournament-registration";

type RegistrationRosterSectionProps = {
  legend: string;
  groups: MemberFieldGroup[];
  values: TournamentRegistrationFormData;
  onChange: React.ChangeEventHandler<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >;
};

export default function RegistrationRosterSection({
  legend,
  groups,
  values,
  onChange,
}: RegistrationRosterSectionProps) {
  return (
    <fieldset>
      <legend>{legend}</legend>
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
    </fieldset>
  );
}
