import { isCoveredByEventCard, type EventSeries, type Tournament } from "./tournaments";

export const gameSlugAliases: Record<string, string> = {
  chess: "e-chess",
  cod: "call-of-duty",
  "call-of-duty-mobile": "codm",
  "cod-mobile": "codm",
  "counter-strike": "counter-strike-2",
  cs2: "counter-strike-2",
  dota: "dota-2",
  dota2: "dota-2",
  "ea-fc": "fc",
  "ea-sports-fc": "fc",
  lol: "league-of-legends",
  "mobile-legends": "mlbb",
  "mobile-legends-bang-bang": "mlbb",
  mk11: "mortal-kombat-11",
  "mortal-kombat": "mortal-kombat-11",
  pubgm: "pubg-mobile",
};

export const normalizeGameSlug = (value: string) => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return gameSlugAliases[slug] || slug;
};

const tournamentGameSlug = (tournament: Tournament) =>
  normalizeGameSlug(tournament.gameCategory?.slug || tournament.game || "");

/** An event is listable once it is published and has a child to advertise. */
export const isListableEvent = (event: EventSeries) =>
  event.isPublished && event.tournaments.length > 0;

/**
 * An event answers to any game one of its children plays, so filtering the grid
 * to VALORANT still surfaces the event that carries the VALORANT bracket rather
 * than hiding the only route to it.
 */
export const eventMatchesGame = (event: EventSeries, gameFilter: string) =>
  gameFilter === "all" || event.tournaments.some((child) => tournamentGameSlug(child) === gameFilter);

export const tournamentMatchesGame = (tournament: Tournament, gameFilter: string) =>
  gameFilter === "all" || tournamentGameSlug(tournament) === gameFilter;

const isCompletedEvent = (event: EventSeries) =>
  event.eventStatus === "completed" || event.tournaments.every((child) => child.isCompleted);

const tournamentTime = (tournament: Tournament) =>
  new Date(tournament.endDate || tournament.startDate || tournament.createdAt || 0).getTime();

/**
 * Builds the single `/tournaments` grid: events lead, then tournaments, with
 * finished entries sinking below live ones inside each group. A tournament whose
 * published event already carries a card is dropped, so one game is never
 * offered twice under two destinations.
 */
export const composeTournamentListing = ({
  tournaments,
  events,
  gameFilter,
}: {
  tournaments: Tournament[];
  events: EventSeries[];
  gameFilter: string;
}) => {
  const listedEvents = events.filter((event) => isListableEvent(event) && eventMatchesGame(event, gameFilter));
  const activeEvents = listedEvents.filter((event) => !isCompletedEvent(event));
  const pastEvents = listedEvents.filter(isCompletedEvent);

  const listedTournaments = tournaments.filter(
    (tournament) => !isCoveredByEventCard(tournament) && tournamentMatchesGame(tournament, gameFilter),
  );
  const activeTournaments = listedTournaments.filter((tournament) => !tournament.isCompleted);
  const pastTournaments = listedTournaments
    .filter((tournament) => tournament.isCompleted)
    .sort((left, right) => tournamentTime(right) - tournamentTime(left));

  return {
    events: [...activeEvents, ...pastEvents],
    tournaments: [...activeTournaments, ...pastTournaments],
    get isEmpty() {
      return this.events.length === 0 && this.tournaments.length === 0;
    },
  };
};
