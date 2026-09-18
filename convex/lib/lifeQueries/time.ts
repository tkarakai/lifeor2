import { date } from "../domain";
export class AmbiguousLocalTimeError extends Error {
  readonly clarification;
  constructor(day: string, time: string, timezone: string, nominal: number, candidates: number[]) {
    const choices = candidates.sort((a, b) => a - b).map((at, i) => {
      const utcOffsetMinutes = (nominal - at) / 60000;
      const magnitude = Math.abs(utcOffsetMinutes);
      const offset = `${utcOffsetMinutes < 0 ? "−" : "+"}${String(Math.floor(magnitude / 60)).padStart(2, "0")}:${String(magnitude % 60).padStart(2, "0")}`;
      return { occurrence: i + 1, label: `${i === 0 ? "First" : "Second"} occurrence (UTC${offset})`, utcOffsetMinutes, occurredAt: new Date(at).toISOString() };
    });
    const question = `${day} at ${time} occurs twice in ${timezone}. Which should I use: ${choices.map(c => c.label.toLowerCase().replace("utc", "UTC")).join(" or ")}?`;
    super(`Ambiguous daylight-saving time. ${question}`);
    this.clarification = { status: "needs_input" as const, kind: "ambiguous_local_time" as const, question, date: day, time, timezone, choices };
  }
}
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
  if (candidates.length > 1)
    throw new AmbiguousLocalTimeError(day, time, timezone, nominal, candidates);
  if (candidates.length !== 1)
    throw new Error(
      "That local date/time does not exist in this timezone. Choose a valid time.",
    );
  return candidates[0];
}
/** Clock facts for display, including the actual occurrence of a repeated minute. */
export function clockFacts(at: number, timezone: string) {
  const day = civilDate(at, timezone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const utcOffset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(at).find(p => p.type === "timeZoneName")!.value.replace("GMT", "UTC");
  let clockOccurrence: string | null = null;
  try { localInstant(day, time, timezone); }
  catch (error) {
    if (error instanceof AmbiguousLocalTimeError) clockOccurrence = error.clarification.choices.find(c => Date.parse(c.occurredAt) === Math.floor(at / 60000) * 60000)?.label ?? null;
  }
  return { utcOffset, clockOccurrence };
}
