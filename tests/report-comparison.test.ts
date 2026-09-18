import { expect, test } from "vitest";
import { compareFinance, percentChange } from "../lib/life-reports/comparison";
import { presentReport } from "../lib/mcp/report-presentation";
const expenses = (usd: string, eur?: string) => ({
  metric: "expenses", totals: [
    { type: "Expense", amount: usd, currency: "USD" },
    ...(eur ? [{ type: "Expense", amount: eur, currency: "EUR" }] : []),
  ], rows: [
    { accountId: "groceries", account: "Groceries", type: "Expense", currency: "USD", amount: usd },
  ],
});
test("period changes preserve scope, exact money, currency and zero-baseline meaning", () => {
  const report = compareFinance(expenses("1057.00", "10.00"), expenses("1046.00"));
  expect(report.totals.find(r => r.currency === "USD")).toMatchObject({ baseline: "1046.00", current: "1057.00", difference: "11.00", percentChange: "1.05" });
  expect(report.totals.find(r => r.currency === "EUR")).toMatchObject({ difference: "10.00", percentChange: null, baselineHasMatches: false });
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].difference).toBe("11.00");
  const text = presentReport({ reportType: "financial_comparison", metric: "expenses", ...report,
    current: { from: "2026-08-01", through: "2026-08-31" }, baseline: { from: "2026-07-01", through: "2026-07-31" },
    scope: ["Household"], basis: "Recorded totals", sourceReportIds: ["current", "baseline"] });
  expect(text).toContain("11.00 USD | 1.05%");
  expect(text).toContain("Unavailable: zero baseline");
  expect(text).toContain("no posted matches");
});
test("percentage arithmetic handles negative baselines, decreases, tiny changes and safe-integer extremes", () => {
  expect(percentChange(50, -100)).toBe("150.00");
  expect(percentChange(75, 100)).toBe("-25.00");
  expect(percentChange(0, 0)).toBeNull();
  expect(percentChange(0, 300)).toBe("-100.00");
  expect(percentChange(9000000000001, 9000000000000)).toBe("0.00");
  expect(percentChange(2, 3)).toBe("-33.33");
});
test("payroll comparisons retain gross and cash as separate measures", () => {
  const report = (gross: string, cash: string) => ({ metric: "payroll", payroll: [{ currency: "USD", totalGross: gross, totalCashDeposited: cash }], rows: [] });
  const result = compareFinance(report("13000.00", "9100.00"), report("6500.00", "4550.00"));
  expect(result.totals).toHaveLength(2);
  expect(result.totals.find(r => r.label === "Payroll cash deposited")).toMatchObject({ difference: "4550.00", percentChange: "100.00" });
});
