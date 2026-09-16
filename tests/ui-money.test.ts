import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, moneyInput } from "../components/money";
describe("UI exact money", () => {
  it("formats declared currency precision without binary floating point", () => {
    expect(formatMoney(12345, "USD")).toBe("USD 123.45");
    expect(formatMoney(-123, "JPY")).toBe("−JPY 123");
    expect(formatMoney(12345, "KWD")).toBe("KWD 12.345");
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD")).toBe(
      "USD 90,071,992,547,409.91",
    );
  });
  it("round-trips editable amounts at every supported precision", () => {
    for (const currency of ["USD", "JPY", "KWD"]) {
      for (const minorUnits of [
        0,
        1,
        -1,
        29,
        Number.MAX_SAFE_INTEGER,
        -Number.MAX_SAFE_INTEGER,
      ]) {
        expect(parseMoney(moneyInput(minorUnits, currency), currency)).toBe(
          minorUnits,
        );
      }
    }
  });
  it("parses user decimal input exactly and rejects rounding and overflow", () => {
    expect(parseMoney("0.29", "USD")).toBe(29);
    expect(parseMoney("-12.345", "KWD")).toBe(-12345);
    expect(() => parseMoney("1.001", "USD")).toThrow();
    expect(() => parseMoney("1.1", "JPY")).toThrow();
    expect(() => parseMoney("90071992547409.92", "USD")).toThrow();
    expect(() => parseMoney("1e3", "USD")).toThrow();
  });
});
