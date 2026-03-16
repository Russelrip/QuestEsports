export type Tournament = {
  slug: string;
  title: string;
  game: string;
  image: string | null;
  prizePool: string;
  completed: string | null;
  format: string;
  status: string;
  description: string;
  registration?: string;
  registrationOpen: boolean;
};

export const TOURNAMENTS: Tournament[] = [
  {
    slug: "valorant-women",
    title: "Valorant Women's Championship 2025",
    game: "valorant",
    image: "/images/womens.jpg",
    prizePool: "LKR 50,000",
    completed: "August 2025",
    format: "BO3 / 5v5",
    status: "Completed",
    description:
      "A special tournament created to spotlight women in competitive Valorant and support the local esports scene.",
    registrationOpen: false,
  },
  {
    slug: "valorant-showdown",
    title: "The Valorant Showdown 2026",
    game: "valorant",
    image: "/images/open.jpg",
    prizePool: "LKR 40,000",
    completed: "February 12",
    format: "BO3 / 5v5",
    status: "Completed",
    description:
      "A competitive Valorant event featuring open teams, structured brackets, and a strong finals stage.",
    registrationOpen: false,
  },
  {
    slug: "quest-masters-open",
    title: "Quest Masters Open 2026",
    game: "valorant",
    image: "/images/openposter.jpg",
    prizePool: "LKR 75,000",
    completed: null,
    format: "BO3 / 5v5",
    status: "Registration Open",
    description:
      "An open-entry Valorant tournament with a polished bracket flow, live coverage, and room for new teams to break through.",
    registration: "Open Now",
    registrationOpen: true,
  },
];

export const isTournamentCompleted = (tournament: Tournament) =>
  tournament.status === "Completed";

export const isTournamentRegistrationOpen = (tournament: Tournament) =>
  tournament.registrationOpen;

export const canRegisterForTournament = (tournament: Tournament) =>
  !isTournamentCompleted(tournament) && isTournamentRegistrationOpen(tournament);

const getTournamentSortPriority = (tournament: Tournament) => {
  if (canRegisterForTournament(tournament)) {
    return 0;
  }

  if (!isTournamentCompleted(tournament)) {
    return 1;
  }

  return 2;
};

export const getTournamentBySlug = (slug: string) =>
  TOURNAMENTS.find((tournament) => tournament.slug === slug);

export const getVisibleTournaments = (gameFilter: string) => {
  const filteredTournaments = TOURNAMENTS.filter(
    (tournament) =>
      gameFilter === "all" ||
      tournament.game === gameFilter ||
      tournament.game === "all"
  );

  return filteredTournaments
    .map((tournament, index) => ({ tournament, index }))
    .sort((left, right) => {
      const priorityDifference =
        getTournamentSortPriority(left.tournament) -
        getTournamentSortPriority(right.tournament);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return left.index - right.index;
    })
    .map(({ tournament }) => tournament);
};

export const getRegisterableTournaments = () =>
  TOURNAMENTS.filter(canRegisterForTournament);

export const getFeaturedTournaments = (limit = 3) =>
  getVisibleTournaments("all").slice(0, limit);
