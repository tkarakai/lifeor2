import { dateRange } from "../../convex/lib/lifeQueries/common";
import { QueryError } from "../mcp/query-error";
export type Period = { from: string; through: string };
/** Period order cannot reverse a chronological change or merge both windows. */
export function comparisonPeriods(a: Period, b: Period) {
  dateRange(a.from, a.through, 36600);
  dateRange(b.from, b.through, 36600);
  const [earlier, later] = [a, b].sort((x, y) => x.from.localeCompare(y.from));
  if (earlier.through >= later.from) throw new QueryError("overlapping_periods", "Supply two exact, separate, non-overlapping date ranges. Do not combine both periods into one window. For overlapping windows, request their independent totals instead.");
  return { earlier, later };
}
export function comparisonSelection(a: Period, b: Period, baselinePeriod: "earlier" | "later" = "earlier") {
  const { earlier, later } = comparisonPeriods(a, b);
  return baselinePeriod === "later"
    ? { current: earlier, baseline: later }
    : { current: later, baseline: earlier };
}
import { add, parseMoney, scale } from "../../convex/lib/domain";
import { decimal } from "./finance";
type Measure = { key: string; label: string; currency: string; amount: string };
/** Signed change divided by the baseline magnitude, rounded to hundredths. */
export function percentChange(current: number, baseline: number): string | null {
  if (!baseline) return null;
  const difference = BigInt(add(current, -baseline));
  const denominator = BigInt(Math.abs(baseline));
  const magnitude = ((difference < 0n ? -difference : difference) * 10000n + denominator / 2n) / denominator;
  const digits = magnitude.toString().padStart(3, "0");
  return `${difference < 0n && magnitude !== 0n ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
function measures(r: Record<string, any>): Measure[] {
  const fields: Record<string, string> = r.metric === "payroll"
    ? { totalGross: "Gross payroll income", totalCashDeposited: "Payroll cash deposited" }
    : r.metric === "profit_loss"
      ? { income: "Income", expense: "Expense", netRecordedIncome: "Net recorded income" }
      : r.metric === "balances"
        ? { assets: "Assets", liabilities: "Liabilities", netWorth: "Book net worth", cash: "Cash" }
        : r.metric === "cash_balances" ? { cash: "Cash" } : {};
  const source = r.payroll ?? r.profitLoss ?? r.balanceSummary ?? r.cashSummary;
  if (source) return source.flatMap((row: any) => Object.entries(fields).map(([key, label]) => ({
    key, label, currency: row.currency, amount: row[key],
  })));
  return r.totals.map((row: any) => ({ key: row.type, label: row.type, currency: row.currency, amount: row.amount }));
}
function compare(current: Measure[], baseline: Measure[]) {
  const key = (m: Measure) => `${m.key}:${m.currency}`;
  const c = new Map(current.map(m => [key(m), m]));
  const b = new Map(baseline.map(m => [key(m), m]));
  return [...new Set([...c.keys(), ...b.keys()])].sort().map(k => {
    const sample = c.get(k) ?? b.get(k)!;
    const currentMinor = parseMoney(c.get(k)?.amount ?? "0", sample.currency);
    const baselineMinor = parseMoney(b.get(k)?.amount ?? "0", sample.currency);
    return { label: sample.label, currency: sample.currency,
      current: decimal(currentMinor, scale(sample.currency)),
      baseline: decimal(baselineMinor, scale(sample.currency)),
      difference: decimal(add(currentMinor, -baselineMinor), scale(sample.currency)),
      percentChange: percentChange(currentMinor, baselineMinor),
      currentHasMatches: c.has(k), baselineHasMatches: b.has(k) };
  });
}
function accountMeasures(report: Record<string, any>): Measure[] {
  const map = new Map<string, Measure>();
  for (const row of report.rows) {
    const key = `${row.accountId}:${row.currency}`;
    const prior = map.get(key);
    const minor = add(parseMoney(prior?.amount ?? "0", row.currency), parseMoney(row.amount, row.currency));
    map.set(key, { key: row.accountId, label: `${row.account} (${row.type})`, currency: row.currency, amount: decimal(minor, scale(row.currency)) });
  }
  return [...map.values()];
}
export function compareFinance(current: Record<string, any>, baseline: Record<string, any>) {
  if (current.metric !== baseline.metric) throw new Error("Comparison metrics must match");
  return {
    totals: compare(measures(current), measures(baseline)),
    rows: compare(accountMeasures(current), accountMeasures(baseline)),
  };
}
