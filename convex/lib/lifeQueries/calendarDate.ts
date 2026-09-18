import { date } from "../domain";
import { civilDate } from "./time";
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const counts = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];
/** Resolve a small explicit civil-date grammar. No model date arithmetic or free-form evaluation. */
export function calendarDate(args: { date?: string; dateExpression?: string }, timezone: string, baseDate?: string, now = Date.now()) {
  if ((args.date === undefined) === (args.dateExpression === undefined)) throw new Error("Supply exactly one of date (YYYY-MM-DD) or dateExpression (the user's relative phrase).");
  if (args.date !== undefined) { date(args.date); return args.date; }
  const phrase = args.dateExpression!.trim().toLowerCase().replace(/\s+/g, " ");
  const today = civilDate(now, timezone);
  let anchor = today, offset: number;
  if (["day after tomorrow", "the day after tomorrow", "day before yesterday", "the day before yesterday"].includes(phrase)) offset = phrase.includes("after") ? 2 : -2;
  else if (["today", "tomorrow", "yesterday"].includes(phrase)) offset = phrase === "today" ? 0 : phrase === "tomorrow" ? 1 : -1;
  else if (/^next (sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.test(phrase)) {
    const current = new Date(today + "T12:00:00Z").getUTCDay();
    offset = (weekdays.indexOf(phrase.slice(5)) - current + 7) % 7 || 7;
  } else {
    const match = /^(?:in )?(\d{1,4}|a|one|zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen) (days?|weeks?)(?: (later|earlier))?$/.exec(phrase);
    if (!match || (!phrase.startsWith("in ") && !match[3])) throw new Error("Unsupported relative date. Use today, tomorrow, yesterday, next <weekday>, in N days/weeks, or N days/weeks later/earlier; otherwise ask for YYYY-MM-DD.");
    const count = /^\d+$/.test(match[1]) ? Number(match[1]) : match[1] === "a" ? 1 : counts.indexOf(match[1]);
    offset = count * (match[2].startsWith("week") ? 7 : 1) * (match[3] === "earlier" ? -1 : 1);
    if (Math.abs(offset) > 3660) throw new Error("Relative calendar changes are limited to 3660 days; use an explicit date for a longer interval.");
    if (match[3]) {
      if (!baseDate) throw new Error("Later/earlier needs the existing appointment as its anchor. Use an explicit date when creating a new event.");
      date(baseDate); anchor = baseDate;
    }
  }
  return new Date(Date.parse(anchor + "T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}
