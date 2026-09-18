import { expect, test } from "vitest";
import { calendarDate } from "../convex/lib/lifeQueries/calendarDate";
import { localInstant } from "../convex/lib/lifeQueries/time";
const now = Date.parse("2026-09-18T15:00:00Z");
test("calendar phrases distinguish today's clock from the existing appointment's date", () => {
  expect(calendarDate({ dateExpression: "next Tuesday" }, "America/Chicago", undefined, now)).toBe("2026-09-22");
  expect(calendarDate({ dateExpression: "two days later" }, "America/Chicago", "2026-09-22", now)).toBe("2026-09-24");
  expect(calendarDate({ dateExpression: "tomorrow" }, "America/Chicago", "2026-09-24", now)).toBe("2026-09-19");
  expect(calendarDate({ dateExpression: "the day after tomorrow" }, "America/Chicago", undefined, now)).toBe("2026-09-20");
  expect(calendarDate({ dateExpression: "a day later" }, "America/Chicago", "2026-09-22", now)).toBe("2026-09-23");
  expect(calendarDate({ dateExpression: "next Tuesday" }, "America/Chicago", undefined, Date.parse("2026-09-22T15:00:00Z"))).toBe("2026-09-29");
  expect(calendarDate({ dateExpression: "tomorrow" }, "America/Chicago", undefined, Date.parse("2026-09-19T01:00:00Z"))).toBe("2026-09-19");
  expect(calendarDate({ dateExpression: "tomorrow" }, "Asia/Tokyo", undefined, Date.parse("2026-09-19T01:00:00Z"))).toBe("2026-09-20");
});
test("relative dates use civil days across leap days and daylight saving, with explicit limits", () => {
  expect(calendarDate({ dateExpression: "one day later" }, "America/Chicago", "2028-02-28", now)).toBe("2028-02-29");
  const day = calendarDate({ dateExpression: "two days later" }, "America/Chicago", "2026-10-31", now);
  expect(new Date(localInstant(day, "15:00", "America/Chicago")).toISOString()).toBe("2026-11-02T21:00:00.000Z");
  expect(() => calendarDate({ dateExpression: "two days later" }, "UTC", undefined, now)).toThrow("existing appointment");
  expect(() => calendarDate({ date: "2026-09-29", dateExpression: "next Tuesday" }, "UTC")).toThrow("exactly one");
  expect(() => calendarDate({ dateExpression: "in 9999 weeks" }, "UTC")).toThrow("3660");
  expect(() => calendarDate({ dateExpression: "sometime next summer" }, "UTC")).toThrow("Unsupported");
});
