import {
  getTournamentRegistrationPresentation,
  type EventSeries,
  type EventStatus,
} from "./tournaments";

type EventStatusKey = EventStatus;

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

export const getEventCardPresentation = (event: EventSeries) => {
  const child = event.tournaments.find(
    (tournament) => getTournamentRegistrationPresentation(tournament).isActionable,
  ) ?? event.tournaments[0] ?? null;

  return {
    eventStatus: getEventStatus(event),
    child,
    childRegistration: child ? getTournamentRegistrationPresentation(child) : null,
  };
};

export const getCountdownTarget = (event: EventSeries, now = new Date()) => {
  const start = dateValue(event.startDate);
  if (start && start <= now) return null;

  const opening = dateValue(event.registrationOpenAt);
  if (opening && opening > now) return { label: "Registration opens", date: opening };
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
