export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatDisplayDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) {
    return "TBD";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  });
}

export type DateAnnouncementStatus = "scheduled" | "tba" | "tbd";

export function formatTournamentDate(
  value: string | null | undefined,
  status: DateAnnouncementStatus = "scheduled",
  options?: Intl.DateTimeFormatOptions
) {
  if (status === "tba") return "TBA";
  if (status === "tbd") return "TBD";
  return formatDisplayDate(value, options);
}

export function formatTournamentDateRange({
  startDate,
  startDateStatus,
  endDate,
  endDateStatus,
}: {
  startDate?: string | null;
  startDateStatus?: DateAnnouncementStatus;
  endDate?: string | null;
  endDateStatus?: DateAnnouncementStatus;
}) {
  const start = formatTournamentDate(startDate, startDateStatus);
  const end = formatTournamentDate(endDate, endDateStatus);
  return start === end ? start : `${start} - ${end}`;
}

export function getInitials(firstName?: string | null, lastName?: string | null, fallback = "") {
  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim().toUpperCase();
  return initials || fallback.slice(0, 2).toUpperCase();
}
