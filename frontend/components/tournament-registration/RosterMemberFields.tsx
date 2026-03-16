import type { TournamentRegistrationFormData } from "@/lib/tournament-registration";

type RosterMemberFieldsProps = {
  prefix: "player2" | "player3" | "player4" | "player5" | "sub1" | "sub2";
  title: string;
  required?: boolean;
  values: TournamentRegistrationFormData;
  onChange: (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => void;
};

export default function RosterMemberFields({
  prefix,
  title,
  required = false,
  values,
  onChange,
}: RosterMemberFieldsProps) {
  const optionalLabel = required ? " *" : " (Optional)";
  const nameField = `${prefix}Name` as keyof TournamentRegistrationFormData;
  const discordField = `${prefix}Discord` as keyof TournamentRegistrationFormData;
  const riotField = `${prefix}RiotId` as keyof TournamentRegistrationFormData;

  return (
    <div className="player-section">
      <h4>
        {title}
        {optionalLabel}
      </h4>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor={String(nameField)}>
            Full Name
            {required ? " *" : ""}
          </label>
          <input
            type="text"
            id={String(nameField)}
            name={String(nameField)}
            required={required}
            value={String(values[nameField])}
            onChange={onChange}
          />
        </div>
        <div className="form-group">
          <label htmlFor={String(discordField)}>
            Discord Username
            {required ? " *" : ""}
          </label>
          <input
            type="text"
            id={String(discordField)}
            name={String(discordField)}
            required={required}
            value={String(values[discordField])}
            onChange={onChange}
          />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor={String(riotField)}>
          Riot ID
          {required ? " *" : ""}
        </label>
        <input
          type="text"
          id={String(riotField)}
          name={String(riotField)}
          required={required}
          value={String(values[riotField])}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
