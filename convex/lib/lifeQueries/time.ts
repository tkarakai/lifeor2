import { date } from "../domain";
export function civilDate(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Resolve a local minute without guessing across a DST fold or gap. */
export function localInstant(
  day: string,
  time: string,
  timezone: string,
  offsetMinutes?: number,
) {
  if (
    offsetMinutes !== undefined &&
    (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 840)
  )
    throw new Error("UTC offset must be whole minutes within -840..840");
  date(day);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Use local time HH:MM");
  const nominal = Date.parse(`${day}T${time}:00Z`),
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  const match = (at: number) => {
    const p = format.formatToParts(at),
      get = (type: string) => p.find((p) => p.type === type)!.value;
    return (
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}` ===
      `${day}T${time}`
    );
  };
  const offsets =
    offsetMinutes === undefined
      ? Array.from({ length: 113 }, (_, i) => (i - 56) * 15)
      : [offsetMinutes];
  const candidates = offsets
    .map((offset) => nominal - offset * 60000)
    .filter(match);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "Ambiguous daylight-saving time. Ask for the UTC offset in minutes."
        : "That local date/time does not exist in this timezone. Choose a valid time.",
    );
  return candidates[0];
}
