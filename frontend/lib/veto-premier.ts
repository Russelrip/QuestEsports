export type PremierMapActionKind = "ban" | "decider" | "pick" | "side" | null;

export type PremierMapPresentation = {
  disabled: boolean;
  locked: boolean;
  label: string;
  bannedBy: string | null;
  actorLabel: string;
};

export function getPremierMapPresentation(actionKind: PremierMapActionKind, actorTeam: "A" | "B" | null, canBan: boolean): PremierMapPresentation {
  if (actionKind === "ban") return { disabled: true, locked: false, label: actorTeam ? `Banned · Team ${actorTeam}` : "Banned", bannedBy: actorTeam, actorLabel: actorTeam ? `Team ${actorTeam}` : "" };
  if (actionKind === "decider") return { disabled: true, locked: true, label: "Map locked", bannedBy: null, actorLabel: "Automatic decider" };
  if (actionKind === "side") return { disabled: true, locked: false, label: "Available", bannedBy: null, actorLabel: "" };
  return { disabled: !canBan, locked: false, label: canBan ? "Select to ban" : "Available", bannedBy: null, actorLabel: "" };
}

export function getPremierBanSlotLabel(completed: boolean, active: boolean, actor: "A" | "B" | null): string {
  if (completed) return actor ? `Team ${actor} · Complete` : "Complete";
  if (active) return "Current";
  return actor ? `Team ${actor}` : "Open";
}
