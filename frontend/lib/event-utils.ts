import type { EventSeries } from "./tournaments";

type EventStatusKey = NonNullable<EventSeries["eventStatus"]>;

const statusLabels: Record<EventStatusKey, string> = {
  draft: "Coming soon",
  upcoming: "Upcoming",
  open: "Registration open",
  closed: "Registration closed",
  completed: "Completed",
};

const dateValue = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getEventStatus = (event: EventSeries) => {
  const key = event.isPublished ? event.eventStatus || event.registrationState || "closed" : "draft";
  return { key, label: statusLabels[key] };
};

export const getCountdownTarget = (event: EventSeries, now = new Date()) => {
  const opening = dateValue(event.registrationOpenAt);
  if (opening && opening > now) return { label: "Registration opens", date: opening };
  const start = dateValue(event.startDate);
  if (start && start > now) return { label: "Event starts", date: start };
  return null;
};

export const formatEventCountdown = (target: Date | null, now = new Date()) => {
  if (!target || target.getTime() <= now.getTime()) return "Starting now";
  const totalHours = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 3_600_000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
};

const countLabel = (count: number, singular: string, empty: string) =>
  count > 0 ? `${count} ${count === 1 ? singular : `${singular}s`}` : empty;

export const getEventRegistrationSummary = (event: EventSeries) => {
  const aggregate = event.aggregate;
  const games = aggregate?.games ?? event.games ?? 0;
  const teams = aggregate?.teamsRegistered ?? event.teamsRegistered ?? 0;
  const players = aggregate?.playersRegistered ?? event.playersRegistered ?? 0;
  const slots = aggregate?.availableSlots ?? event.availableSlots ?? 0;
  const state = aggregate?.registrationState ?? event.registrationState ?? event.eventStatus;
  return {
    games: countLabel(games, "game", "No games announced"),
    teams: countLabel(teams, "team", "No teams registered"),
    players: countLabel(players, "player", "No players registered"),
    slots: slots > 0 ? `${slots} slot${slots === 1 ? "" : "s"} available` : "No slots available",
    isOpen: state === "open",
  };
};
