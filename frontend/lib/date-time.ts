const SRI_LANKA_TIME_ZONE = "Asia/Colombo";
const SRI_LANKA_UTC_OFFSET = "+05:30";

const DATE_TIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function sriLankaDateTimeLocalToIso(value: string) {
  const match = DATE_TIME_LOCAL_PATTERN.exec(value);
  if (!match) return value;

  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${SRI_LANKA_UTC_OFFSET}`
  );
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function isoToSriLankaDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SRI_LANKA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function formatSriLankaDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {}
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";

  return date.toLocaleString("en-US", {
    timeZone: SRI_LANKA_TIME_ZONE,
    ...options,
  });
}
