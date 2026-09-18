import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  collectFinance,
  decimal,
  summarizeFinance,
  type FinancePage,
} from "../life-reports/finance";
import { scale } from "../../convex/lib/domain";
import { saveReport, readReport } from "./report-store";
import { compareFinance } from "../life-reports/comparison";
export async function financialReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
  snapshotClient?: ConvexHttpClient,
) {
  if (args.comparison !== undefined) {
    const comparison = args.comparison as { from: string; through: string };
    if (!comparison || typeof comparison.from !== "string" || typeof comparison.through !== "string")
      throw new Error("Specify both baseline comparison dates: from and through");
    const { comparison: _comparison, ...currentArgs } = args;
    const current = await baseFinancialReport(client, token, scope, currentArgs, snapshotClient);
    const baseline = await baseFinancialReport(client, token, scope, { ...currentArgs, from: comparison.from, through: comparison.through }, snapshotClient);
    if (current.revision !== baseline.revision) throw new Error("DATA_CHANGED: records changed between comparison periods. Retry; no mixed-version comparison was supplied.");
    const currentFull = (await readReport(scope, current.reportId)).report;
    const baselineFull = (await readReport(scope, baseline.reportId)).report;
    const result = {
      reportType: "financial_comparison", metric: args.metric,
      current: { from: args.from, through: args.through },
      baseline: comparison, scope: currentFull.scope,
      ...compareFinance(currentFull, baselineFull),
      sourceReportIds: [current.reportId, baseline.reportId],
      queryComplete: true, sampleActualsThrough: currentFull.sampleActualsThrough,
      basis: "Both periods use the same scope, metric and filters. Difference is current minus baseline. Percentage is 100 × difference / absolute baseline; it is unavailable for a zero baseline. These are recorded totals, not extrapolated or inflation-adjusted amounts. No matching postings contribute zero to recorded differences, not proof of zero real-life activity.",
    };
    return { ...result, ...(await saveReport(scope, result)), rows: result.rows.slice(0, 8), rowCount: result.rows.length, rowsComplete: result.rows.length <= 8, nextOffset: result.rows.length > 8 ? 8 : null };
  }
  return baseFinancialReport(client, token, scope, args, snapshotClient);
}
export async function baseFinancialReport(
  client: ConvexHttpClient,
  token: string,
  scope: { userId: string; connectionId: string; datasetId: string },
  args: Record<string, unknown>,
  snapshotClient?: ConvexHttpClient,
) {
  const { cursor: _cursor, ...input } = args;
  const start = Date.now();
  // A monotonic dataset revision is read in the same transaction as each page.
  // Equal revisions on every page establish one data version without holding an
  // experimental backend timestamp past its short retention window. Legacy
  // scopes without revision coverage still require a pinned snapshot.
  const snapshot = snapshotClient ?? new ConvexHttpClient(client.url);
  const collect = (pinned: boolean) => collectFinance(async (cursor) => {
    if (Date.now() - start > 150_000)
      throw new Error("QUERY_LIMIT: report exceeded 150 seconds. Narrow the period; no partial total was supplied.");
    const query = makeFunctionReference<"query">("agentFinance:summary");
    const parameters = { ...input, agentToken: token, ...(cursor ? { cursor } : {}) };
    return (await (pinned ? snapshot.consistentQuery(query, parameters) : client.query(query, parameters))) as FinancePage;
  }, 10000, !pinned);
  let consistency = snapshotClient ? "pinned_snapshot" : "dataset_revision";
  let report;
  try {
    report = await collect(!!snapshotClient);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PINNED_SNAPSHOT_REQUIRED" && !snapshotClient) {
      consistency = "pinned_snapshot";
      report = await collect(true);
    } else if (snapshotClient && /InternalServerError|Timestamp.*too early|out_of_retention/.test(message)) {
      // Compound callers also compare this revision with their planning inputs.
      consistency = "dataset_revision";
      report = await collect(false);
    } else throw error;
  }
  const result = {
    reportType: "financial",
    consistency,
    ...report,
    rows: report.rows.map((r) => ({
      period: r.period,
      accountId: r.accountId,
      account: r.account,
      type: r.type,
      currency: r.currency,
      amount: decimal(r.minorUnits, scale(r.currency)),
      cashAccount: r.cash,
      sourceJournalIds: r.journalIds,
      contributionCount: r.sourceCount,
      sourcesComplete: r.sourceCount <= r.journalIds.length,
    })),
    ...summarizeFinance(
      report.rows,
      String(
        ["balances", "cash_balances"].includes(String(args.metric))
          ? args.through
          : args.from,
      ),
      String(args.through),
      scale,
      String(args.metric),
    ),
    scopeFilters: Object.fromEntries(
      Object.entries(input).filter(
        ([key]) =>
          !["datasetId", "from", "through", "metric", "groupBy"].includes(key),
      ),
    ),
    metric: args.metric,
    basis:
      args.metric === "cash_balances"
        ? "Recorded bank/cash-account balances through cutoff, including opening entries. Only designated checking, savings and cash accounts are included. These balances cannot establish the market value of everything owned or market net worth; that requires dated asset valuations and liabilities. This is not a forecast or a consolidation of legal ownership."
        : args.metric === "payroll"
          ? "Recorded payroll events: gross income and actual bank deposits are separate. cashDeposited and averageMonthlyCash aggregate the requested calendar-month windows; they are not per-paycheck amounts. Missing months are not verified zero; partial boundary months are not extrapolated. Future pay is a schedule projection, not this report."
          : args.metric === "profit_loss"
            ? "Recorded recognized income less posted expenses in the selected scope. Capital purchases, principal and equity/transfer movements are excluded. This is not a consolidated tax profit or a cash-flow measure."
            : args.metric === "cashflow"
              ? "Recorded signed cash-account changes (positive inflow, negative outflow), filtered by the requested event kind if supplied. These can include transfers or owner funding; they are not automatically earnings."
              : args.metric === "income"
                ? "Recorded gross Income credits minus debits; not net take-home pay."
                : args.metric === "expenses"
                  ? "Posted Expense debits minus credits; excludes capital purchases, principal and transfers."
                  : ["balances", "cash_balances"].includes(String(args.metric))
                    ? "Posted balances through cutoff, including opening entries. Assets display net debits; liabilities and equity display net credits; do not sum assets and liabilities as net worth."
                    : "Signed posted debits minus credits by account; capital costs, expense, cash and liabilities remain separate.",
    coverage:
      "Dataset completeness unknown. Undated journals excluded. Source IDs are bounded examples; totals include every matching page. Subject filters use explicit attribution or an unambiguous journal subject; ownership does not imply income attribution.",
  };
  const saved = await saveReport(scope, result);
  return {
    ...result,
    ...saved,
    rows: result.rows.slice(0, args.metric === "payroll" ? 0 : 8),
    totals: result.totals.map((total) =>
      "months" in total && total.months
        ? {
            ...total,
            months: total.months.slice(0, 8),
            monthCount: total.months.length,
            monthsComplete: total.months.length <= 8,
          }
        : total,
    ),
    ...("payroll" in result && result.payroll
      ? {
          payroll: result.payroll.map((p) => ({
            ...p,
            months: p.months.slice(0, 8),
            monthCount: p.months.length,
            monthsComplete: p.months.length <= 8,
          })),
        }
      : {}),
    rowCount: result.rows.length,
    nextOffset:
      result.rows.length > (args.metric === "payroll" ? 0 : 8)
        ? args.metric === "payroll"
          ? 0
          : 8
        : null,
    rowsComplete: result.rows.length <= (args.metric === "payroll" ? 0 : 8),
  };
}
