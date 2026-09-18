import { expect, test } from "vitest";
import { matchesText } from "../convex/lib/lifeQueries/text";
test("query vocabulary accepts equivalent pay, car and plural terms while requiring each distinct identity word", () => {
  expect(
    matchesText(
      "Alex monthly gross salary (two payroll deposits)",
      "paycheck salary payroll",
    ),
  ).toBe(true);
  expect(matchesText("Honda Civic Vehicle", "cars")).toBe(true);
  expect(matchesText("Oak Street mortgage", "mortgages")).toBe(true);
  expect(matchesText("Alex Morgan", "Alex Morgan")).toBe(true);
  expect(matchesText("Jamie Morgan", "Alex Morgan")).toBe(false);
  expect(matchesText("Payroll", "dentist")).toBe(false);
});
