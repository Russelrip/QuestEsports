import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { TournamentRegistrationFormData } from "@/lib/tournament-registration";

export default function RosterMemberFields({
  prefix,
  title,
  required = false,
  values,
  onChange,
}: {
  prefix: "player2" | "player3" | "player4" | "player5" | "sub1" | "sub2";
  title: string;
  required?: boolean;
  values: TournamentRegistrationFormData;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  const nameField = `${prefix}Name` as keyof TournamentRegistrationFormData;
  const emailField = `${prefix}Email` as keyof TournamentRegistrationFormData;
  const discordField = `${prefix}Discord` as keyof TournamentRegistrationFormData;
  const riotField = `${prefix}RiotId` as keyof TournamentRegistrationFormData;

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
      <h4 className="text-xl text-white">{title}</h4>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <FormField label="Full Name" htmlFor={String(nameField)} required={required}>
          <Input
            type="text"
            id={String(nameField)}
            name={String(nameField)}
            required={required}
            value={String(values[nameField])}
            onChange={onChange}
          />
        </FormField>
        <FormField label="Email Address" htmlFor={String(emailField)} required={required}>
          <Input
            type="email"
            id={String(emailField)}
            name={String(emailField)}
            required={required}
            value={String(values[emailField])}
            onChange={onChange}
          />
        </FormField>
        <FormField label="Discord Username" htmlFor={String(discordField)} required={required}>
          <Input
            type="text"
            id={String(discordField)}
            name={String(discordField)}
            required={required}
            value={String(values[discordField])}
            onChange={onChange}
          />
        </FormField>
        <FormField label="Riot ID" htmlFor={String(riotField)} required={required}>
          <Input
            type="text"
            id={String(riotField)}
            name={String(riotField)}
            required={required}
            value={String(values[riotField])}
            onChange={onChange}
          />
        </FormField>
      </div>
    </div>
  );
}
